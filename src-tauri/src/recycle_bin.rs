//! Application-owned, durable deletion history. Files keep their original bytes and paths.
use crate::{
    json_io::write_json_atomic,
    services::notes::{default_store, AppError, NoteMetadata, NoteStore},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    fs,
    path::{Component, Path, PathBuf},
    sync::{Mutex, MutexGuard},
};
use tauri::Emitter;

static LOCK: Mutex<()> = Mutex::new(());
pub fn lock() -> MutexGuard<'static, ()> {
    LOCK.lock().unwrap_or_else(|e| e.into_inner())
}
fn error(message: impl Into<String>) -> AppError {
    AppError {
        code: "recycleBin".into(),
        message: message.into(),
        details: Default::default(),
    }
}
fn root(data: &Path) -> PathBuf {
    data.join("回收站")
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub(crate) id: String,
    kind: String,
    name: String,
    origin: String,
    deleted_at: i64,
    #[serde(default)]
    files: Vec<String>,
    #[serde(default)]
    notes: Vec<NoteMetadata>,
    #[serde(default)]
    record: Option<Record>,
    #[serde(default)]
    pending: bool,
}
#[derive(Clone, Serialize, Deserialize)]
struct Record {
    file: String,
    parent: Option<String>,
    field: String,
    index: usize,
    value: Value,
}
fn entry(kind: &str, name: String, origin: String) -> Entry {
    Entry {
        id: uuid::Uuid::new_v4().to_string(),
        kind: kind.into(),
        name,
        origin,
        deleted_at: chrono::Utc::now().timestamp_millis(),
        files: vec![],
        notes: vec![],
        record: None,
        pending: false,
    }
}
fn entry_dir(data: &Path, id: &str) -> Result<PathBuf, AppError> {
    uuid::Uuid::parse_str(id).map_err(|_| error("无效的回收站条目"))?;
    let path = root(data).join(id);
    reject_links(data, &path)?;
    Ok(path)
}
fn reject_links(base: &Path, path: &Path) -> Result<(), AppError> {
    let relative = path
        .strip_prefix(base)
        .map_err(|_| error("路径不在数据目录内"))?;
    let mut current = base.to_path_buf();
    for component in relative.components() {
        if !matches!(component, Component::Normal(_)) {
            return Err(error("无效的回收站路径"));
        }
        current.push(component);
        if let Ok(meta) = fs::symlink_metadata(&current) {
            if meta.file_type().is_symlink() {
                return Err(error("不能操作符号链接，请检查原目录"));
            }
        }
    }
    Ok(())
}
fn target(data: &Path, relative: &str) -> Result<PathBuf, AppError> {
    let path = data.join(relative);
    reject_links(data, &path)?;
    let book_path = path.strip_prefix(data.join("书籍")).ok().is_some_and(|p| {
        p.components().count() == 1
            && p.to_str()
                .is_some_and(|id| uuid::Uuid::parse_str(id).is_ok())
    });
    if !book_path && (!path.starts_with(data.join("notes")) || path == data.join("notes")) {
        return Err(error("无效的笔记恢复位置"));
    }
    Ok(path)
}
fn read_entry(data: &Path, id: &str) -> Result<Entry, AppError> {
    let item: Entry = serde_json::from_str(&fs::read_to_string(
        entry_dir(data, id)?.join("entry.json"),
    )?)?;
    if item.id != id {
        return Err(error("回收站条目不匹配"));
    }
    Ok(item)
}
pub fn list(data: &Path) -> Result<Vec<Entry>, AppError> {
    if !root(data).exists() {
        return Ok(vec![]);
    }
    reject_links(data, &root(data))?;
    let mut items = vec![];
    for file in fs::read_dir(root(data))? {
        let file = file?;
        if file.file_type()?.is_dir() && file.path().join("entry.json").exists() {
            let item = read_entry(data, &file.file_name().to_string_lossy())?;
            if item.pending {
                rollback_pending(data, &item)?;
            } else {
                items.push(item);
            }
        }
    }
    items.sort_by_key(|item| std::cmp::Reverse(item.deleted_at));
    Ok(items)
}

// A interrupted multi-file move is rolled back on the next open, including its metadata.
fn rollback_pending(data: &Path, item: &Entry) -> Result<(), AppError> {
    let dir = entry_dir(data, &item.id)?;
    for relative in &item.files {
        let dest = target(data, relative)?;
        let source = dir.join("files").join(relative);
        reject_links(data, &source)?;
        if source.exists() && dest.exists() {
            return Err(error(
                "中断的删除遇到同名文件，已保留两份内容，请检查原目录",
            ));
        }
        if !source.exists() && !dest.exists() {
            return Err(error("中断的删除缺少原文件，已保留回收站记录"));
        }
    }
    for relative in &item.files {
        let source = dir.join("files").join(relative);
        if source.exists() {
            let dest = target(data, relative)?;
            fs::create_dir_all(dest.parent().unwrap())?;
            fs::rename(source, dest)?;
        }
    }
    NoteStore::new(data.to_path_buf(), data.to_path_buf()).restore_note_metadata(&item.notes)?;
    fs::remove_dir_all(dir)?;
    Ok(())
}

pub fn archive_files(
    data: &Path,
    kind: &str,
    name: String,
    origin: String,
    paths: Vec<PathBuf>,
    notes: Vec<NoteMetadata>,
    commit: impl FnOnce() -> Result<(), AppError>,
) -> Result<(), AppError> {
    let mut item = entry(kind, name, origin);
    item.pending = true;
    item.notes = notes;
    for path in paths.into_iter().filter(|p| p.exists()) {
        let relative = path
            .strip_prefix(data)
            .map_err(|_| error("删除路径不在数据目录内"))?
            .to_string_lossy()
            .to_string();
        target(data, &relative)?;
        item.files.push(relative);
    }
    if item.files.is_empty() {
        return Err(error("原文件不存在，请刷新后重试"));
    }
    let dir = entry_dir(data, &item.id)?;
    write_json_atomic(&dir.join("entry.json"), &item)?;
    let result = (|| {
        for relative in &item.files {
            let source = target(data, relative)?;
            let dest = dir.join("files").join(relative);
            fs::create_dir_all(dest.parent().unwrap())?;
            fs::rename(&source, &dest)?;
        }
        commit()?;
        item.pending = false;
        write_json_atomic(&dir.join("entry.json"), &item)
    })();
    if result.is_err() {
        rollback_pending(data, &item)?;
    }
    result
}

// Called under the shared mutation lock. Capture only removed records, never whole-file rollback.
pub fn save_with_history<T: Serialize>(data: &Path, file: &str, next: &T) -> Result<(), AppError> {
    let path = data.join(file);
    let old: Value = if path.exists() {
        serde_json::from_str(&fs::read_to_string(&path)?)?
    } else {
        Value::Null
    };
    let next = serde_json::to_value(next)?;
    let before = records(file, &old);
    let after = records(file, &next);
    let mut created = vec![];
    let added: Vec<_> = after
        .iter()
        .filter(|(_, _, _, r)| !before.iter().any(|(_, _, _, old)| same_record(r, old)))
        .collect();
    for (kind, name, origin, record) in before {
        if after.iter().any(|(_, _, _, r)| same_record(r, &record)) {
            continue;
        }
        let mut item = entry(kind, name, origin);
        item.record = Some(record);
        let dir = entry_dir(data, &item.id)?;
        if let Err(e) = write_json_atomic(&dir.join("entry.json"), &item) {
            for path in created {
                let _ = fs::remove_dir_all(path);
            }
            return Err(e);
        }
        created.push(dir);
    }
    if let Err(e) = write_json_atomic(&path, &next) {
        for path in created {
            let _ = fs::remove_dir_all(path);
        }
        return Err(e);
    }
    // The existing Undo buttons restore the same record. Retire its trash copy after saving.
    for item in if added.is_empty() {
        vec![]
    } else {
        list(data)?
    } {
        if let Some(record) = &item.record {
            if added
                .iter()
                .any(|(_, _, _, r)| same_record(r, record) && r.value == record.value)
            {
                fs::remove_dir_all(entry_dir(data, &item.id)?)?;
            }
        }
    }
    Ok(())
}
fn same_record(a: &Record, b: &Record) -> bool {
    a.file == b.file && a.parent == b.parent && a.field == b.field && a.value["id"] == b.value["id"]
}
fn records(file: &str, document: &Value) -> Vec<(&'static str, String, String, Record)> {
    let mut result = vec![];
    let mut add =
        |rows: &Value, parent: Option<String>, field: &str, kind: &'static str, origin: String| {
            if let Some(rows) = rows.as_array() {
                for (index, value) in rows.iter().enumerate() {
                    let name = value["text"]
                        .as_str()
                        .or(value["title"].as_str())
                        .or(value["taskTitle"].as_str())
                        .unwrap_or("专注记录")
                        .to_owned();
                    result.push((
                        kind,
                        name,
                        origin.clone(),
                        Record {
                            file: file.into(),
                            parent: parent.clone(),
                            field: field.into(),
                            index,
                            value: value.clone(),
                        },
                    ));
                }
            }
        };
    match file {
        "四象限.json" => add(document, None, "", "quadrant", "四象限".into()),
        "番茄钟.json" => add(
            &document["records"],
            None,
            "records",
            "pomodoro",
            "番茄钟".into(),
        ),
        "项目.json" => {
            if let Some(projects) = document.as_array() {
                for project in projects {
                    add(
                        &project["tasks"],
                        project["id"].as_str().map(str::to_owned),
                        "tasks",
                        "requirement",
                        format!("项目 / {}", project["name"].as_str().unwrap_or("未命名")),
                    );
                }
            }
        }
        _ => (),
    }
    result
}
pub fn restore(store: &NoteStore, id: &str) -> Result<Option<Value>, AppError> {
    let data = store.data_dir();
    let item = read_entry(data, id)?;
    let dir = entry_dir(data, id)?;
    let mut restored_records = None;
    if let Some(record) = &item.record {
        if !["四象限.json", "番茄钟.json", "项目.json"].contains(&record.file.as_str()) {
            return Err(error("不支持的恢复类型"));
        }
        let path = data.join(&record.file);
        let mut document: Value = serde_json::from_str(&fs::read_to_string(&path)?)?;
        let rows = match record.file.as_str() {
            "四象限.json" => document.as_array_mut(),
            "番茄钟.json" => document["records"].as_array_mut(),
            _ => document
                .as_array_mut()
                .and_then(|ps| {
                    ps.iter_mut()
                        .find(|p| p["id"].as_str() == record.parent.as_deref())
                })
                .and_then(|p| p["tasks"].as_array_mut()),
        }
        .ok_or_else(|| error("原项目或列表不存在，暂时无法恢复"))?;
        if let Some(existing) = rows.iter().find(|r| r["id"] == record.value["id"]) {
            if existing != &record.value {
                return Err(error("原位置已有同一条记录，恢复不会覆盖现有内容"));
            }
        } else {
            rows.insert(record.index.min(rows.len()), record.value.clone());
        }
        write_json_atomic(&path, &document)?;
        if record.file == "番茄钟.json" {
            restored_records = Some(document["records"].clone());
        }
    } else {
        // Preflight every destination before moving any file. Never overwrite a new note/folder.
        for relative in &item.files {
            if target(data, relative)?.exists() {
                return Err(error("原位置已有同名文件或分类，请先改名或移走，再恢复"));
            }
            let source = dir.join("files").join(relative);
            reject_links(data, &source)?;
            if !source.exists() {
                return Err(error("回收站中的原文件缺失，未执行恢复"));
            }
        }
        store.check_restore_notes(&item.notes)?;
        let mut moved = vec![];
        let result = (|| {
            for relative in &item.files {
                let dest = target(data, relative)?;
                let source = dir.join("files").join(relative);
                fs::create_dir_all(dest.parent().unwrap())?;
                fs::rename(&source, &dest)?;
                moved.push((source, dest));
            }
            store.restore_note_metadata(&item.notes)
        })();
        if let Err(e) = result {
            for (source, dest) in moved.iter().rev() {
                fs::rename(dest, source)?;
            }
            return Err(e);
        }
    }
    fs::remove_dir_all(dir)?;
    Ok(restored_records)
}
#[tauri::command]
pub fn trash_list() -> Result<Vec<Entry>, AppError> {
    let _guard = lock();
    list(default_store()?.data_dir())
}
#[tauri::command]
pub fn trash_restore(app: tauri::AppHandle, id: String) -> Result<Option<Value>, AppError> {
    let _guard = lock();
    let restored = restore(&default_store()?, &id)?;
    let _ = app.emit("notes-changed", ());
    Ok(restored)
}
#[tauri::command]
pub fn trash_delete(ids: Vec<String>) -> Result<(), AppError> {
    let _guard = lock();
    let store = default_store()?;
    purge(store.data_dir(), ids)
}
fn purge(data: &Path, ids: Vec<String>) -> Result<(), AppError> {
    for id in ids {
        let path = entry_dir(data, &id)?;
        if path.exists() {
            fs::remove_dir_all(path)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn sandbox() -> PathBuf {
        let p = std::env::temp_dir().join(format!("floral-trash-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&p).unwrap();
        p
    }
    #[test]
    fn record_restore_merges_with_new_work_and_undo_retires_entry() {
        let data = sandbox();
        let store = NoteStore::new(data.clone(), data.clone());
        let a = json!({"id":"a","text":"原任务","quadrant":2,"completed":false});
        let b = json!({"id":"b","text":"后来新增","quadrant":0,"completed":false});
        save_with_history(&data, "四象限.json", &vec![a.clone()]).unwrap();
        save_with_history(&data, "四象限.json", &vec![b.clone()]).unwrap();
        let deleted = list(&data).unwrap();
        assert_eq!(deleted.len(), 1);
        restore(&store, &deleted[0].id).unwrap();
        let rows: Vec<Value> =
            serde_json::from_str(&fs::read_to_string(data.join("四象限.json")).unwrap()).unwrap();
        assert_eq!(rows, vec![a.clone(), b.clone()]);
        assert!(list(&data).unwrap().is_empty());
        save_with_history(&data, "四象限.json", &vec![b.clone()]).unwrap();
        assert_eq!(list(&data).unwrap().len(), 1);
        save_with_history(&data, "四象限.json", &vec![a, b]).unwrap();
        assert!(list(&data).unwrap().is_empty());
        fs::remove_dir_all(data).unwrap();
    }
    #[test]
    fn project_and_timer_restore_preserve_unrelated_fields() {
        let data = sandbox();
        let store = NoteStore::new(data.clone(), data.clone());
        let task = json!({"id":"t","text":"需求","stage":"developing","completed":false,"plannedDate":"2026-10-20"});
        let before = json!([{"id":"p","name":"项目","tasks":[task.clone()],"noteIds":["n"]}]);
        save_with_history(&data, "项目.json", &before).unwrap();
        let after = json!([{"id":"p","name":"新名称","tasks":[],"noteIds":["n","new"]}]);
        save_with_history(&data, "项目.json", &after).unwrap();
        restore(&store, &list(&data).unwrap()[0].id).unwrap();
        let restored: Value =
            serde_json::from_str(&fs::read_to_string(data.join("项目.json")).unwrap()).unwrap();
        assert_eq!(restored[0]["tasks"][0], task);
        assert_eq!(restored[0]["name"], "新名称");
        assert_eq!(restored[0]["noteIds"], json!(["n", "new"]));
        let record = json!({"id":"r","seconds":130,"interrupted":true});
        save_with_history(
            &data,
            "番茄钟.json",
            &json!({"records":[record.clone()],"remaining":1500}),
        )
        .unwrap();
        save_with_history(&data, "番茄钟.json", &json!({"records":[],"remaining":900})).unwrap();
        restore(&store, &list(&data).unwrap()[0].id).unwrap();
        let timer: Value =
            serde_json::from_str(&fs::read_to_string(data.join("番茄钟.json")).unwrap()).unwrap();
        assert_eq!(timer["records"][0], record);
        assert_eq!(timer["remaining"], 900);
        fs::remove_dir_all(data).unwrap();
    }
    #[test]
    fn failed_commit_rolls_back_files_and_rejects_escape_paths() {
        let data = sandbox();
        fs::create_dir_all(data.join("notes")).unwrap();
        let path = data.join("notes/原始.md");
        fs::write(&path, b"original\r\nbytes").unwrap();
        assert!(archive_files(
            &data,
            "note",
            "名称".into(),
            "未分类".into(),
            vec![path.clone()],
            vec![],
            || Err(error("save failed"))
        )
        .is_err());
        assert_eq!(fs::read(&path).unwrap(), b"original\r\nbytes");
        assert!(list(&data).unwrap().is_empty());
        assert!(target(&data, "notes/../../outside").is_err());
        assert!(target(&data, "配置/config.json").is_err());
        assert!(entry_dir(&data, "../notes").is_err());
        fs::remove_dir_all(data).unwrap();
    }
    #[test]
    fn interrupted_move_recovers_and_purge_only_removes_selected_entry() {
        let data = sandbox();
        fs::create_dir_all(data.join("notes")).unwrap();
        let mut pending = entry("attachment", "图片".into(), "笔记".into());
        pending.pending = true;
        pending.files = vec!["notes/a.png".into(), "notes/b.png".into()];
        let dir = entry_dir(&data, &pending.id).unwrap();
        fs::create_dir_all(dir.join("files/notes")).unwrap();
        fs::write(dir.join("files/notes/a.png"), b"a").unwrap();
        fs::write(data.join("notes/b.png"), b"b").unwrap();
        write_json_atomic(&dir.join("entry.json"), &pending).unwrap();
        assert!(list(&data).unwrap().is_empty());
        assert_eq!(fs::read(data.join("notes/a.png")).unwrap(), b"a");
        for name in ["a.png", "b.png"] {
            archive_files(
                &data,
                "attachment",
                name.into(),
                "笔记".into(),
                vec![data.join("notes").join(name)],
                vec![],
                || Ok(()),
            )
            .unwrap();
        }
        let entries = list(&data).unwrap();
        assert_eq!(entries.len(), 2);
        purge(&data, vec![entries[0].id.clone()]).unwrap();
        assert_eq!(list(&data).unwrap().len(), 1);
        assert!(!entry_dir(&data, &entries[0].id).unwrap().exists());
        purge(&data, vec![entries[1].id.clone()]).unwrap();
        assert!(list(&data).unwrap().is_empty());
        fs::remove_dir_all(data).unwrap();
    }
}
