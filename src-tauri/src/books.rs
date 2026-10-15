use crate::{
    json_io::write_json_atomic,
    services::notes::{default_store, AppError},
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};
use tauri::Manager;

const FORMATS: &[&str] = &["epub", "pdf", "mobi", "azw", "azw3", "fb2", "cbz", "txt"];
fn error(message: impl Into<String>) -> AppError {
    AppError {
        code: "books".into(),
        message: message.into(),
        details: Default::default(),
    }
}
fn now() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ReadingMode {
    Page,
    Scroll,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Book {
    pub id: String,
    pub title: String,
    pub file_name: String,
    pub format: String,
    pub size: u64,
    pub hash: String,
    pub imported_at: i64,
    pub last_read_at: Option<i64>,
    pub location: Option<String>,
    pub progress: f64,
    #[serde(default)]
    pub reading_mode: Option<ReadingMode>,
}
fn directory(data: &Path, id: &str) -> Result<PathBuf, AppError> {
    uuid::Uuid::parse_str(id).map_err(|_| error("无效的书籍编号"))?;
    let root = data.join("书籍");
    let dir = root.join(id);
    for p in [&root, &dir] {
        if fs::symlink_metadata(p).is_ok_and(|m| m.file_type().is_symlink()) {
            return Err(error("书籍目录不能是符号链接"));
        }
    }
    Ok(dir)
}
fn read(data: &Path, id: &str) -> Result<Book, AppError> {
    let book: Book = serde_json::from_slice(&fs::read(directory(data, id)?.join("book.json"))?)?;
    if book.id != id
        || Path::new(&book.file_name).components().count() != 1
        || book.file_name.contains(['/', '\\', ':'])
        || !FORMATS.contains(&book.format.as_str())
    {
        return Err(error("书籍信息无效"));
    }
    Ok(book)
}
fn list(data: &Path) -> Result<Vec<Book>, AppError> {
    let root = data.join("书籍");
    if !root.exists() {
        return Ok(vec![]);
    }
    let mut books = Vec::new();
    for item in fs::read_dir(root)? {
        let item = item?;
        let id = item.file_name().to_string_lossy().into_owned();
        if uuid::Uuid::parse_str(&id).is_ok() {
            books.push(read(data, &id)?);
        }
    }
    books.sort_by_key(|b| std::cmp::Reverse(b.last_read_at.unwrap_or(b.imported_at)));
    Ok(books)
}
fn import(data: &Path, source: &Path) -> Result<Book, AppError> {
    let format = source
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    if !FORMATS.contains(&format.as_str()) {
        return Err(error(
            "暂不支持此格式，可导入 EPUB、PDF、MOBI、AZW、AZW3、FB2、CBZ、TXT",
        ));
    }
    if !source.is_file() {
        return Err(error("请拖入书籍文件"));
    }
    let name = source
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or_else(|| error("文件名无效"))?;
    let id = uuid::Uuid::new_v4().to_string();
    let dest = directory(data, &id)?;
    let stage = dest.with_file_name(format!(".import-{id}"));
    fs::create_dir_all(&stage)?;
    // Hash the copied bytes so duplicate detection also works across different file names.
    let result = (|| {
        let mut input = fs::File::open(source)?;
        let mut output = fs::File::create(stage.join(name))?;
        let mut digest = Sha256::new();
        let mut buf = [0u8; 65536];
        let mut size = 0u64;
        loop {
            let count = input.read(&mut buf)?;
            if count == 0 {
                break;
            }
            output.write_all(&buf[..count])?;
            digest.update(&buf[..count]);
            size += count as u64;
        }
        output.sync_all()?;
        drop(output);
        if size == 0 {
            return Err(error("书籍文件为空"));
        }
        let hash = format!("{:x}", digest.finalize());
        if let Some(existing) = list(data)?
            .into_iter()
            .find(|b| b.hash == hash && b.format == format)
        {
            return Ok(existing);
        }
        let book = Book {
            id,
            title: source
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned(),
            file_name: name.into(),
            format,
            size,
            hash,
            imported_at: now(),
            last_read_at: None,
            location: None,
            progress: 0.0,
            reading_mode: None,
        };
        write_json_atomic(&stage.join("book.json"), &book)?;
        fs::rename(&stage, dest)?;
        Ok(book)
    })();
    if stage.exists() {
        let _ = fs::remove_dir_all(stage);
    }
    result
}
fn progress(data: &Path, id: &str, location: String, progress: f64) -> Result<(), AppError> {
    if !progress.is_finite() || location.len() > 16384 {
        return Err(error("阅读位置无效"));
    }
    let mut book = read(data, id)?;
    book.location = Some(location);
    book.progress = progress.clamp(0.0, 1.0);
    book.last_read_at = Some(now());
    write_json_atomic(&directory(data, id)?.join("book.json"), &book)
}
fn delete(data: &Path, id: &str) -> Result<(), AppError> {
    let book = read(data, id)?;
    crate::recycle_bin::archive_files(
        data,
        "book",
        book.title,
        "书籍".into(),
        vec![directory(data, id)?],
        vec![],
        || Ok(()),
    )
}
fn reading_mode(data: &Path, id: &str, mode: ReadingMode) -> Result<(), AppError> {
    let mut book = read(data, id)?;
    book.reading_mode = Some(mode);
    write_json_atomic(&directory(data, id)?.join("book.json"), &book)
}

#[tauri::command]
pub async fn books_import(path: String) -> Result<Book, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = crate::recycle_bin::lock();
        import(default_store()?.data_dir(), Path::new(&path))
    })
    .await
    .map_err(|e| error(e.to_string()))?
}
#[tauri::command]
pub fn books_list() -> Result<Vec<Book>, AppError> {
    let _guard = crate::recycle_bin::lock();
    list(default_store()?.data_dir())
}
#[tauri::command]
pub fn books_path(app: tauri::AppHandle, id: String) -> Result<String, AppError> {
    let _guard = crate::recycle_bin::lock();
    let store = default_store()?;
    let book = read(store.data_dir(), &id)?;
    let path = directory(store.data_dir(), &id)?.join(book.file_name);
    if fs::symlink_metadata(&path)?.file_type().is_symlink() {
        return Err(error("书籍文件不能是符号链接"));
    }
    app.asset_protocol_scope()
        .allow_file(&path)
        .map_err(|e| error(e.to_string()))?;
    Ok(path.to_string_lossy().into_owned())
}
#[tauri::command]
pub fn books_progress(id: String, location: String, fraction: f64) -> Result<(), AppError> {
    let _guard = crate::recycle_bin::lock();
    progress(default_store()?.data_dir(), &id, location, fraction)
}
#[tauri::command]
pub fn books_reading_mode(id: String, reading_mode: ReadingMode) -> Result<(), AppError> {
    let _guard = crate::recycle_bin::lock();
    self::reading_mode(default_store()?.data_dir(), &id, reading_mode)
}
#[tauri::command]
pub fn books_delete(id: String) -> Result<(), AppError> {
    let _guard = crate::recycle_bin::lock();
    delete(default_store()?.data_dir(), &id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::notes::NoteStore;
    #[test]
    fn copied_books_deduplicate_resume_and_restore_intact() {
        let root = std::env::temp_dir().join(format!("books-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let data = root.join("data");
        let source = root.join("中文 书籍.txt");
        fs::write(&source, "第一章\n书籍内容").unwrap();
        let book = import(&data, &source).unwrap();
        assert_eq!(import(&data, &source).unwrap().id, book.id);
        fs::remove_file(source).unwrap();
        // Metadata from versions before reading modes were introduced remains readable.
        let metadata_path = directory(&data, &book.id).unwrap().join("book.json");
        let mut legacy: serde_json::Value =
            serde_json::from_slice(&fs::read(&metadata_path).unwrap()).unwrap();
        legacy.as_object_mut().unwrap().remove("readingMode");
        write_json_atomic(&metadata_path, &legacy).unwrap();
        assert!(read(&data, &book.id).unwrap().reading_mode.is_none());
        reading_mode(&data, &book.id, ReadingMode::Page).unwrap();
        progress(&data, &book.id, "0.42".into(), 0.42).unwrap();
        assert!(matches!(
            read(&data, &book.id).unwrap().reading_mode,
            Some(ReadingMode::Page)
        ));
        reading_mode(&data, &book.id, ReadingMode::Scroll).unwrap();
        assert_eq!(list(&data).unwrap()[0].location.as_deref(), Some("0.42"));
        assert_eq!(
            fs::read_to_string(directory(&data, &book.id).unwrap().join(&book.file_name)).unwrap(),
            "第一章\n书籍内容"
        );
        delete(&data, &book.id).unwrap();
        assert!(list(&data).unwrap().is_empty());
        let entries = crate::recycle_bin::list(&data).unwrap();
        let store = NoteStore::new(root.join("config"), data.clone());
        crate::recycle_bin::restore(&store, &entries[0].id).unwrap();
        assert_eq!(list(&data).unwrap()[0].progress, 0.42);
        assert!(matches!(
            list(&data).unwrap()[0].reading_mode,
            Some(ReadingMode::Scroll)
        ));
        assert!(directory(&data, "../escape").is_err());
        let empty = root.join("empty.epub");
        fs::write(&empty, "").unwrap();
        assert!(import(&data, &empty).is_err());
        assert_eq!(list(&data).unwrap().len(), 1);
        fs::remove_dir_all(root).unwrap();
    }
}
