use crate::services::notes::{default_store, AppError, Note, SaveNoteRequest};
use serde::{Deserialize, Serialize};
use std::{path::Path, sync::Mutex};

static LOCK: Mutex<()> = Mutex::new(());

// Use the ordinary Markdown note store so project notes share the existing editor pipeline.
#[tauri::command]
pub fn projects_create_note(
    project_id: String,
    legacy_id: Option<String>,
) -> Result<Note, AppError> {
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let _trash_guard = crate::recycle_bin::lock();
    let store = default_store()?;
    let path = store.data_dir().join("项目.json");
    let mut projects = read(&path)?;
    let project = projects
        .iter_mut()
        .find(|p| p.id == project_id)
        .ok_or_else(|| AppError {
            code: "project".into(),
            message: "项目不存在".into(),
            details: Default::default(),
        })?;
    let legacy = if let Some(id) = &legacy_id {
        Some(
            project
                .notes
                .iter()
                .find(|n| &n.id == id)
                .cloned()
                .ok_or_else(|| AppError {
                    code: "project".into(),
                    message: "笔记已变化，请返回项目重试".into(),
                    details: Default::default(),
                })?,
        )
    } else {
        None
    };
    let note = store.create_note(SaveNoteRequest {
        title: legacy.as_ref().map(|n| n.title.clone()).unwrap_or_default(),
        content: legacy
            .as_ref()
            .map(|n| n.content.clone())
            .unwrap_or_default(),
        category: String::new(),
    })?;
    project.note_ids.push(note.id.clone());
    if let Some(id) = legacy_id {
        project.notes.retain(|n| n.id != id);
    }
    project.updated_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    if let Err(error) = crate::json_io::write_json_atomic(&path, &projects) {
        drop(_trash_guard);
        let _ = store.delete_note(&note.id);
        return Err(error);
    }
    Ok(note)
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    id: String,
    name: String,
    status: Status,
    created_at: u64,
    updated_at: u64,
    #[serde(default)]
    tasks: Vec<ProjectTask>,
    #[serde(default)]
    note_ids: Vec<String>,
    #[serde(default)]
    notes: Vec<ProjectNote>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectNote {
    id: String,
    title: String,
    content: String,
    updated_at: u64,
}

#[tauri::command]
pub fn projects_save_note(project_id: String, note: ProjectNote) -> Result<Vec<Project>, AppError> {
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let _trash_guard = crate::recycle_bin::lock();
    let path = default_store()?.data_dir().join("项目.json");
    let mut projects = read(&path)?;
    update_note(&mut projects, &project_id, note)?;
    crate::json_io::write_json_atomic(&path, &projects)?;
    Ok(projects)
}

fn update_note(
    projects: &mut [Project],
    project_id: &str,
    note: ProjectNote,
) -> Result<(), AppError> {
    let project = projects
        .iter_mut()
        .find(|p| p.id == project_id)
        .ok_or_else(|| AppError {
            code: "project".into(),
            message: "项目不存在".into(),
            details: Default::default(),
        })?;
    let mut note = note;
    note.updated_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    project.updated_at = note.updated_at;
    if let Some(existing) = project.notes.iter_mut().find(|n| n.id == note.id) {
        *existing = note;
    } else {
        project.notes.push(note);
    }
    Ok(())
}

#[derive(Clone, Serialize, Deserialize)]
pub struct ProjectTask {
    id: String,
    text: String,
    completed: bool,
    #[serde(default)]
    stage: Option<RequirementStage>,
    #[serde(default, rename = "plannedDate")]
    planned_date: String,
}

#[derive(Clone, Copy, PartialEq, Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RequirementStage {
    Backlog,
    Planned,
    Developing,
    Done,
}

impl ProjectTask {
    fn normalize(&mut self) {
        let stage = self.stage.unwrap_or(if self.completed {
            RequirementStage::Done
        } else {
            RequirementStage::Backlog
        });
        self.stage = Some(stage);
        self.completed = stage == RequirementStage::Done;
    }
}

#[tauri::command]
pub fn projects_save_content(
    id: String,
    tasks: Vec<ProjectTask>,
    note_ids: Vec<String>,
) -> Result<Vec<Project>, AppError> {
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let _trash_guard = crate::recycle_bin::lock();
    let path = default_store()?.data_dir().join("项目.json");
    let mut projects = read(&path)?;
    update_content(&mut projects, &id, tasks, note_ids)?;
    crate::recycle_bin::save_with_history(path.parent().unwrap(), "项目.json", &projects)?;
    Ok(projects)
}

fn update_content(
    projects: &mut [Project],
    id: &str,
    tasks: Vec<ProjectTask>,
    note_ids: Vec<String>,
) -> Result<(), AppError> {
    let project = projects
        .iter_mut()
        .find(|p| p.id == id)
        .ok_or_else(|| AppError {
            code: "project".into(),
            message: "项目不存在，请返回列表重试".into(),
            details: Default::default(),
        })?;
    if tasks
        .iter()
        .any(|t| t.text.trim().is_empty() || t.text.chars().count() > 500)
    {
        return Err(AppError {
            code: "project".into(),
            message: "需求内容请输入 1～500 个字符".into(),
            details: Default::default(),
        });
    }
    let mut tasks = tasks;
    for task in &mut tasks {
        task.normalize();
        if !task.planned_date.is_empty()
            && chrono::NaiveDate::parse_from_str(&task.planned_date, "%Y-%m-%d").is_err()
        {
            return Err(AppError {
                code: "project".into(),
                message: "计划日期无效".into(),
                details: Default::default(),
            });
        }
    }
    project.tasks = tasks;
    project.note_ids = note_ids;
    project.updated_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    Ok(())
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Planned,
    Active,
    Maintenance,
    Paused,
    Archived,
}

fn read(path: &Path) -> Result<Vec<Project>, AppError> {
    match std::fs::read_to_string(path) {
        Ok(value) => Ok(serde_json::from_str(&value)?),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(vec![]),
        Err(error) => Err(error.into()),
    }
}

#[tauri::command]
pub fn projects_load() -> Result<Vec<Project>, AppError> {
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let _trash_guard = crate::recycle_bin::lock();
    read(&default_store()?.data_dir().join("项目.json"))
}

#[tauri::command]
pub fn projects_upsert(
    id: Option<String>,
    name: String,
    status: Status,
) -> Result<Vec<Project>, AppError> {
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let _trash_guard = crate::recycle_bin::lock();
    let path = default_store()?.data_dir().join("项目.json");
    let mut projects = read(&path)?;
    update(&mut projects, id, name, status)?;
    crate::json_io::write_json_atomic(&path, &projects)?;
    Ok(projects)
}

fn update(
    projects: &mut Vec<Project>,
    id: Option<String>,
    name: String,
    status: Status,
) -> Result<(), AppError> {
    let name = name.trim().to_string();
    let error = |message: &str| AppError {
        code: "project".into(),
        message: message.into(),
        details: Default::default(),
    };
    if name.is_empty() || name.chars().count() > 80 {
        return Err(error("项目名称请输入 1～80 个字符"));
    }
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    if let Some(id) = id {
        let project = projects
            .iter_mut()
            .find(|p| p.id == id)
            .ok_or_else(|| error("项目不存在，请刷新后重试"))?;
        project.name = name;
        project.status = status;
        project.updated_at = now;
    } else {
        projects.push(Project {
            id: uuid::Uuid::new_v4().to_string(),
            name,
            status,
            created_at: now,
            updated_at: now,
            tasks: vec![],
            note_ids: vec![],
            notes: vec![],
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn requirement_stages_migrate_and_roundtrip() {
        let mut legacy: ProjectTask =
            serde_json::from_str(r#"{"id":"t","text":"旧任务","completed":true}"#).unwrap();
        legacy.normalize();
        assert_eq!(legacy.stage, Some(RequirementStage::Done));
        let mut rows = vec![];
        update(&mut rows, None, "需求项目".into(), Status::Active).unwrap();
        let id = rows[0].id.clone();
        for stage in [
            RequirementStage::Backlog,
            RequirementStage::Planned,
            RequirementStage::Developing,
            RequirementStage::Done,
            RequirementStage::Planned,
        ] {
            legacy.stage = Some(stage);
            legacy.planned_date = "2026-10-15".into();
            update_content(&mut rows, &id, vec![legacy.clone()], vec!["n".into()]).unwrap();
            let loaded: Vec<Project> =
                serde_json::from_str(&serde_json::to_string(&rows).unwrap()).unwrap();
            assert_eq!(loaded[0].tasks[0].stage, Some(stage));
            assert_eq!(
                loaded[0].tasks[0].completed,
                stage == RequirementStage::Done
            );
            assert_eq!(loaded[0].tasks[0].planned_date, "2026-10-15");
            assert_eq!(loaded[0].note_ids, vec!["n"]);
        }
        legacy.planned_date = "2026-02-30".into();
        assert!(update_content(&mut rows, &id, vec![legacy], vec![]).is_err());
        assert_eq!(rows[0].tasks[0].planned_date, "2026-10-15");
        let mut unfinished: ProjectTask =
            serde_json::from_str(r#"{"id":"u","text":"未完成","completed":false}"#).unwrap();
        unfinished.normalize();
        assert_eq!(unfinished.stage, Some(RequirementStage::Backlog));
    }
    #[test]
    fn notes_belong_to_project_and_updates_do_not_duplicate() {
        let mut rows = vec![];
        update(&mut rows, None, "A".into(), Status::Active).unwrap();
        update(&mut rows, None, "B".into(), Status::Active).unwrap();
        let id = rows[0].id.clone();
        for content in ["旧内容", "新内容"] {
            update_note(
                &mut rows,
                &id,
                ProjectNote {
                    id: "n".into(),
                    title: "需求".into(),
                    content: content.into(),
                    updated_at: 0,
                },
            )
            .unwrap();
        }
        assert_eq!(rows[0].notes.len(), 1);
        assert_eq!(rows[0].notes[0].content, "新内容");
        assert!(rows[1].notes.is_empty());
        update_content(&mut rows, &id, vec![], vec![]).unwrap();
        assert_eq!(rows[0].notes[0].content, "新内容");
        let saved = serde_json::to_string(&rows).unwrap();
        assert_eq!(
            serde_json::from_str::<Vec<Project>>(&saved).unwrap()[0].notes[0].title,
            "需求"
        );
    }
    #[test]
    fn content_is_isolated_and_old_projects_load() {
        let mut rows: Vec<Project> = serde_json::from_str(r#"[{"id":"a","name":"A","status":"active","createdAt":1,"updatedAt":1},{"id":"b","name":"B","status":"active","createdAt":1,"updatedAt":1}]"#).unwrap();
        assert!(rows[0].tasks.is_empty());
        update_content(
            &mut rows,
            "a",
            vec![ProjectTask {
                id: "t".into(),
                text: "待办".into(),
                completed: false,
                stage: None,
                planned_date: String::new(),
            }],
            vec!["note".into()],
        )
        .unwrap();
        assert!(rows[1].tasks.is_empty());
        assert!(rows[1].note_ids.is_empty());
        update(&mut rows, Some("a".into()), "改名".into(), Status::Active).unwrap();
        assert_eq!(rows[0].tasks.len(), 1);
        assert_eq!(rows[0].note_ids, vec!["note"]);
        assert!(update_content(&mut rows, "missing", vec![], vec![]).is_err());
    }
    #[test]
    fn storage_roundtrip_and_corruption_are_distinct_from_empty() {
        let dir =
            std::env::temp_dir().join(format!("floral-project-test-{}", uuid::Uuid::new_v4()));
        let path = dir.join("projects.json");
        assert!(read(&path).unwrap().is_empty());
        let mut rows = vec![];
        update(&mut rows, None, "项目".into(), Status::Active).unwrap();
        crate::json_io::write_json_atomic(&path, &rows).unwrap();
        assert_eq!(read(&path).unwrap()[0].id, rows[0].id);
        std::fs::write(&path, "invalid").unwrap();
        assert!(read(&path).is_err());
        std::fs::remove_file(&path).unwrap();
        std::fs::remove_dir(&dir).unwrap();
    }
    #[test]
    fn create_edit_preserves_identity_and_rejects_invalid_input() {
        let mut rows = vec![];
        assert!(update(&mut rows, None, "  ".into(), Status::Active).is_err());
        update(&mut rows, None, " 花笺 ".into(), Status::Active).unwrap();
        let id = rows[0].id.clone();
        let created = rows[0].created_at;
        update(
            &mut rows,
            Some(id.clone()),
            "新名称".into(),
            Status::Archived,
        )
        .unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, id);
        assert_eq!(rows[0].created_at, created);
        assert_eq!(rows[0].name, "新名称");
        assert!(update(
            &mut rows,
            Some("missing".into()),
            "名称".into(),
            Status::Active
        )
        .is_err());
        let serialized = serde_json::to_string(&rows).unwrap();
        assert_eq!(
            serde_json::from_str::<Vec<Project>>(&serialized).unwrap()[0].name,
            "新名称"
        );
    }
}
