use super::*;
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

struct ImageFixture(String);
struct ImageReport(Mutex<Option<mpsc::Sender<Result<(), String>>>>);

#[tauri::command]
fn image_verification_fixture(state: tauri::State<ImageFixture>) -> String {
    state.0.clone()
}

#[tauri::command]
fn image_verification_report(
    app: AppHandle,
    state: tauri::State<ImageReport>,
    error: Option<String>,
) {
    let outcome = error.map_or_else(
        || {
            let store = default_store().map_err(|e| e.to_string())?;
            let fixture = app.state::<ImageFixture>();
            let id = &fixture.0;
            let note = store.read_note(id).map_err(|e| e.to_string())?;
            let path = store
                .image_base_dir(id)
                .map_err(|e| e.to_string())?
                .join(note.file_name);
            let scope = app.asset_protocol_scope();
            if scope.is_allowed(path) || scope.is_allowed(store.data_dir().join("metadata.json")) {
                return Err("image permission must not expose note text or metadata".into());
            }
            Ok(())
        },
        Err,
    );
    if let Some(send) = state.0.lock().unwrap().take() {
        let _ = send.send(outcome);
    }
}

#[test]
#[ignore = "creates a real WebView2; requires the running Vite preview"]
fn native_note_images_render_after_paste_rename_and_reload() {
    let root = env::temp_dir().join(format!("知行 图片验收 {}", uuid::Uuid::new_v4()));
    let config = root.join("配置");
    let data = root.join("数据");
    env::set_var("FLORAL_NOTEPAPER_CONFIG_DIR", &config);
    env::set_var("FLORAL_NOTEPAPER_DATA_DIR", &data);
    let store = default_store().unwrap();
    let note = store
        .create_note(SaveNoteRequest {
            title: "中文 空格".into(),
            content: "图片粘贴验收\n".into(),
            category: String::new(),
        })
        .unwrap();
    let image_dir = store.images_dir(&note.id);
    assert!(
        !image_dir.exists(),
        "the first paste must work before an attachment directory exists"
    );
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    context
        .config_mut()
        .identifier
        .push_str(".image-verification");
    let (send, receive) = mpsc::channel();
    let outcome = Arc::new(Mutex::new(None));
    let result = outcome.clone();
    let app = tauri::Builder::default()
        .any_thread()
        .manage(ImageFixture(note.id.clone()))
        .manage(ImageReport(Mutex::new(Some(send))))
        .invoke_handler(tauri::generate_handler![
            image_verification_fixture,
            image_verification_report,
            images_get_base_dir,
            images_save,
            notes_get,
            notes_update
        ])
        .setup(move |app| {
            // Match production's legacy scope, then exercise images_get_base_dir through IPC.
            app.asset_protocol_scope()
                .allow_directory(data.join("images"), true)?;
            assert!(!app
                .asset_protocol_scope()
                .is_allowed(image_dir.join("future.png")));
            assert!(!app
                .asset_protocol_scope()
                .is_allowed(data.join("metadata.json")));
            tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("tests/desktop/note-images.html".into()),
            )
            .title("本地图片原生验收")
            .visible(false)
            .build()?;
            Ok(())
        })
        .build(context)
        .unwrap();
    let handle = app.handle().clone();
    std::thread::spawn(move || {
        let checked = receive
            .recv_timeout(Duration::from_secs(30))
            .unwrap_or_else(|_| Err("native image verification timed out".into()));
        *result.lock().unwrap() = Some(checked);
        handle.exit(0);
    });
    app.run_return(|_, _| {});
    let checked = outcome
        .lock()
        .unwrap()
        .take()
        .expect("native verification did not return");
    env::remove_var("FLORAL_NOTEPAPER_CONFIG_DIR");
    env::remove_var("FLORAL_NOTEPAPER_DATA_DIR");
    fs::remove_dir_all(root).unwrap();
    checked.unwrap();
}
