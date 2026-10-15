use crate::services::notes::AppError;
use serde::Serialize;
use std::{collections::VecDeque, sync::Mutex};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

pub const LABEL: &str = "pomodoro-desktop";
const WIDTH: f64 = 320.0;
const TIMER_HEIGHT: f64 = 94.0;
const NOTICE_HEIGHT: f64 = 164.0;

#[derive(Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DesktopTimer {
    pub title: String,
    pub mode: String,
    pub ends_at: Option<u64>,
    pub remaining: u32,
    pub seconds: u32,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Completion {
    pub id: String,
    pub title: String,
    pub focus: bool,
    pub seconds: u32,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    revision: u64,
    timer: Option<DesktopTimer>,
    notice: Option<Completion>,
    notice_count: usize,
}

#[derive(Default)]
struct DesktopState {
    timer: Option<DesktopTimer>,
    notices: VecDeque<Completion>,
    revision: u64,
    ready: bool,
    rendered_revision: Option<u64>,
    open_requested: bool,
}
impl DesktopState {
    fn snapshot(&self) -> Snapshot {
        Snapshot {
            revision: self.revision,
            timer: self.timer.clone(),
            notice: self.notices.front().cloned(),
            notice_count: self.notices.len(),
        }
    }
    fn update(&mut self, timer: Option<DesktopTimer>) {
        if self.timer != timer {
            self.timer = timer;
            self.revision += 1;
        }
    }
    fn complete(&mut self, notice: Completion) {
        if !self.notices.iter().any(|n| n.id == notice.id) {
            self.notices.push_back(notice);
            self.revision += 1;
        }
    }
    fn dismiss(&mut self, id: &str) {
        // An old click/response must never dismiss a newer completion.
        if self.notices.front().is_some_and(|n| n.id == id) {
            self.notices.pop_front();
            self.revision += 1;
        }
    }
}

#[derive(Default)]
pub struct DesktopPomodoro(Mutex<DesktopState>);

fn error(message: &str) -> AppError {
    AppError {
        code: "pomodoroWindow".into(),
        message: message.into(),
        details: Default::default(),
    }
}
fn report_failure(app: &AppHandle, err: AppError) {
    eprintln!("pomodoro desktop reminder: {}", err.message);
    // Bring the app back if the independent window could not be displayed.
    let _ = crate::desktop::show_main_window(app);
    let _ = app.emit_to("main", "pomodoro://alert-error", err.message);
}

// run_on_main_thread runs inline when called from a sync IPC handler. Hop to a
// worker first so WebView2's resource callback returns before creating a WebView.
// Window updates remain serialized by the event loop.
fn refresh(app: &AppHandle) -> Result<(), AppError> {
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let window_handle = handle.clone();
        if let Err(err) = handle.run_on_main_thread(move || {
            if let Err(err) = sync_window(&window_handle) {
                report_failure(&window_handle, err);
            }
        }) {
            report_failure(&handle, err.into());
        }
    });
    Ok(())
}

pub fn update_timer(app: &AppHandle, timer: Option<DesktopTimer>) -> Result<(), AppError> {
    app.state::<DesktopPomodoro>()
        .0
        .lock()
        .map_err(|_| error("桌面计时窗口不可用"))?
        .update(timer);
    refresh(app)
}
pub fn complete(app: &AppHandle, notice: Completion) -> Result<(), AppError> {
    app.state::<DesktopPomodoro>()
        .0
        .lock()
        .map_err(|_| error("桌面提醒不可用"))?
        .complete(notice);
    refresh(app)
}

fn clamped_position(
    position: Option<(i32, i32)>,
    area: (i32, i32, u32, u32),
    size: (u32, u32),
    margin: i32,
) -> (i32, i32) {
    let (left, top, width, height) = area;
    let right = left.saturating_add(width.saturating_sub(size.0) as i32);
    let bottom = top.saturating_add(height.saturating_sub(size.1) as i32);
    let (x, y) = position.unwrap_or((right.saturating_sub(margin), bottom.saturating_sub(margin)));
    (x.clamp(left, right), y.clamp(top, bottom))
}

fn sync_window(app: &AppHandle) -> Result<(), AppError> {
    let (snapshot, ready) = {
        let state = app.state::<DesktopPomodoro>();
        let state = state.0.lock().map_err(|_| error("桌面提醒不可用"))?;
        (
            state.snapshot(),
            state.ready && state.rendered_revision == Some(state.revision),
        )
    };
    if snapshot.timer.is_none() && snapshot.notice.is_none() {
        if let Some(window) = app.get_webview_window(LABEL) {
            window.hide()?;
        }
        return Ok(());
    }
    let height = if snapshot.notice.is_some() {
        NOTICE_HEIGHT
    } else {
        TIMER_HEIGHT
    };
    let existing = app.get_webview_window(LABEL);
    let newly_created = existing.is_none();
    let window = if let Some(window) = existing {
        window
    } else {
        let builder = WebviewWindowBuilder::new(
            app,
            LABEL,
            WebviewUrl::App("index.html?view=pomodoro-desktop".into()),
        )
        .title("花笺 · 番茄钟")
        .inner_size(WIDTH, height)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .shadow(false)
        .skip_taskbar(true)
        .focused(false)
        .focusable(false)
        .visible(false);
        #[cfg(target_os = "windows")]
        let builder = if crate::services::notes::is_portable_build() {
            builder.data_directory(crate::services::notes::default_config_dir()?.join("网页缓存"))
        } else {
            builder
        };
        builder.build()?
    };
    // Keep the user's dragged position; clamp it after resizing or monitor changes.
    let monitor = if newly_created {
        app.get_webview_window("main")
            .and_then(|w| w.current_monitor().ok().flatten())
    } else {
        window.current_monitor()?
    }
    .or(window.primary_monitor()?);
    window.set_size(tauri::LogicalSize::new(WIDTH, height))?;
    if let Some(monitor) = monitor {
        let area = monitor.work_area();
        let scale = monitor.scale_factor();
        let position = if newly_created {
            None
        } else {
            window.outer_position().ok().map(|p| (p.x, p.y))
        };
        let (x, y) = clamped_position(
            position,
            (
                area.position.x,
                area.position.y,
                area.size.width,
                area.size.height,
            ),
            (
                (WIDTH * scale).ceil() as u32,
                (height * scale).ceil() as u32,
            ),
            (18.0 * scale).round() as i32,
        );
        window.set_position(tauri::PhysicalPosition::new(x, y))?;
    }
    window.set_always_on_top(true)?;
    window.emit("pomodoro://desktop-state", snapshot)?;
    // The webview acknowledges after layout. Never show an empty/blank reminder window.
    if ready && !newly_created {
        window.unminimize()?;
        window.show()?;
    }
    Ok(())
}

#[tauri::command]
pub fn pomodoro_desktop_snapshot(app: AppHandle) -> Result<Snapshot, AppError> {
    Ok(app
        .state::<DesktopPomodoro>()
        .0
        .lock()
        .map_err(|_| error("桌面提醒不可用"))?
        .snapshot())
}
#[tauri::command]
pub fn pomodoro_desktop_ready(
    app: AppHandle,
    window: WebviewWindow,
    revision: u64,
) -> Result<(), AppError> {
    if window.label() != LABEL {
        return Err(error("无效的提醒窗口"));
    }
    {
        let state = app.state::<DesktopPomodoro>();
        let mut state = state.0.lock().map_err(|_| error("桌面提醒不可用"))?;
        if revision != state.revision {
            return Ok(());
        }
        state.ready = true;
        state.rendered_revision = Some(revision);
    }
    refresh(&app)
}
#[tauri::command]
pub fn pomodoro_desktop_dismiss(app: AppHandle, id: String) -> Result<(), AppError> {
    app.state::<DesktopPomodoro>()
        .0
        .lock()
        .map_err(|_| error("桌面提醒不可用"))?
        .dismiss(&id);
    refresh(&app)
}
#[tauri::command]
pub fn pomodoro_desktop_open(app: AppHandle, notice_id: Option<String>) -> Result<(), AppError> {
    {
        let state = app.state::<DesktopPomodoro>();
        let mut state = state.0.lock().map_err(|_| error("桌面提醒不可用"))?;
        state.open_requested = true;
    }
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let result = (|| -> Result<(), AppError> {
            crate::desktop::show_main_window(&handle)?;
            handle.emit_to("main", "pomodoro://open", ())?;
            if let Some(id) = notice_id {
                pomodoro_desktop_dismiss(handle.clone(), id)?;
            }
            Ok(())
        })();
        if let Err(err) = result {
            report_failure(&handle, err);
        }
    })?;
    Ok(())
}
#[tauri::command]
pub fn pomodoro_take_open_request(app: AppHandle) -> Result<bool, AppError> {
    let state = app.state::<DesktopPomodoro>();
    let mut state = state.0.lock().map_err(|_| error("桌面提醒不可用"))?;
    Ok(std::mem::take(&mut state.open_requested))
}
pub fn handle_window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    if window.label() != LABEL {
        return;
    }
    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        // Closing through the OS can't accidentally destroy the timer's only desktop surface.
        api.prevent_close();
        let app = window.app_handle();
        if let Ok(snapshot) = pomodoro_desktop_snapshot(app.clone()) {
            if let Some(notice) = snapshot.notice {
                let _ = pomodoro_desktop_dismiss(app.clone(), notice.id);
            }
        }
    }
    if matches!(event, tauri::WindowEvent::Destroyed) {
        if let Ok(mut state) = window.app_handle().state::<DesktopPomodoro>().0.lock() {
            state.ready = false;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(all(target_os = "windows", feature = "desktop-verification"))]
    #[test]
    #[ignore = "creates a real desktop webview; requires the running Vite preview"]
    fn real_desktop_deadline_displays_topmost_window_and_dismisses() {
        use std::sync::{mpsc, Arc};
        use std::time::{Duration, Instant};
        #[tauri::command]
        fn config_get() -> serde_json::Value {
            serde_json::json!({ "theme": "light", "locale": "zh-CN" })
        }
        #[tauri::command]
        fn desktop_verification_start(app: AppHandle) -> Result<(), AppError> {
            // Match the synchronous IPC path used by pomodoro_save, without writing user data.
            let deadline = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64
                + 8000;
            update_timer(
                &app,
                Some(DesktopTimer {
                    title: "桌面提醒验收".into(),
                    mode: "focus".into(),
                    ends_at: Some(deadline),
                    remaining: 8,
                    seconds: 60,
                }),
            )?;
            crate::pomodoro::start_desktop_verification(&app, deadline);
            Ok(())
        }
        #[derive(Default)]
        struct MainProbe(std::sync::atomic::AtomicBool);
        #[tauri::command]
        fn desktop_verification_probe(app: AppHandle) {
            app.state::<MainProbe>()
                .0
                .store(true, std::sync::atomic::Ordering::SeqCst);
        }
        #[tauri::command]
        fn desktop_verification_error(message: String) {
            eprintln!("verification IPC error: {message}");
        }
        let mut context = tauri::generate_context!();
        context.config_mut().app.windows.clear();
        context
            .config_mut()
            .identifier
            .push_str(".desktop-verification");
        let (send, receive) = mpsc::channel::<Result<(), String>>();
        let outcome = Arc::new(Mutex::new(None));
        let outcome_for_thread = outcome.clone();
        let app = tauri::Builder::default().any_thread()
            .invoke_handler(tauri::generate_handler![config_get, desktop_verification_start, desktop_verification_probe, desktop_verification_error, pomodoro_desktop_snapshot, pomodoro_desktop_ready, pomodoro_desktop_dismiss, pomodoro_desktop_open, pomodoro_take_open_request])
            .on_window_event(handle_window_event)
            .setup(move |app| {
                app.manage(DesktopPomodoro::default());
                app.manage(MainProbe::default());
                // Start from an existing WebView, not setup: creating the second WebView
                // from a synchronous WebView2 callback is the reported regression.
                WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html?view=pomodoro-desktop".into()))
                    .title("番茄钟 IPC 验收")
                    .visible(false)
                    .on_page_load(|window, payload| {
                        if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                            let _ = window.eval("window.__TAURI_INTERNALS__.invoke('desktop_verification_start').then(() => window.__TAURI_INTERNALS__.invoke('desktop_verification_probe')).catch(e => window.__TAURI_INTERNALS__.invoke('desktop_verification_error', {message: String(e)}));");
                        }
                    })
                    .build()?;
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    let result = (|| -> Result<(), String> {
                        let start = Instant::now();
                        // The running widget must appear promptly, before completion.
                        loop {
                            std::thread::sleep(Duration::from_millis(100));
                            let snapshot = pomodoro_desktop_snapshot(handle.clone()).map_err(|e| e.message)?;
                            if let Some(window) = handle.get_webview_window(LABEL) {
                                if window.is_visible().map_err(|e| e.to_string())? {
                                    if snapshot.notice.is_some() { return Err("running widget only appeared after completion".into()); }
                                    if !handle.state::<MainProbe>().0.load(std::sync::atomic::Ordering::SeqCst) { return Err("main WebView IPC did not return after starting the timer".into()); }
                                    break;
                                }
                            }
                            if start.elapsed() > Duration::from_secs(6) { return Err(format!("starting through main WebView IPC did not show the running widget: timer={}, window={}, probe={}", snapshot.timer.is_some(), handle.get_webview_window(LABEL).is_some(), handle.state::<MainProbe>().0.load(std::sync::atomic::Ordering::SeqCst))); }
                        }
                        loop {
                            std::thread::sleep(Duration::from_millis(150));
                            let state = handle.state::<DesktopPomodoro>();
                            let state = state.0.lock().unwrap();
                            if state.notices.front().is_some() && state.ready && state.rendered_revision == Some(state.revision) { break; }
                            if start.elapsed() > Duration::from_secs(25) { return Err("real desktop webview failed to acknowledge the native completion".into()); }
                        }
                        let window = handle.get_webview_window(LABEL).ok_or("native window missing")?;
                        // Wait for the deferred native resize/show, not a fixed sleep.
                        let shown = Instant::now();
                        loop {
                            let size = window.inner_size().map_err(|e| e.to_string())?;
                            let scale = window.scale_factor().map_err(|e| e.to_string())?;
                            if window.is_visible().map_err(|e| e.to_string())? && (size.height as f64 / scale - NOTICE_HEIGHT).abs() <= 2.0 { break; }
                            if shown.elapsed() > Duration::from_secs(3) { return Err(format!("completion window failed to expand/show: {size:?}")); }
                            std::thread::sleep(Duration::from_millis(100));
                        }
                        if !window.is_visible().map_err(|e| e.to_string())? { return Err("completion window was hidden".into()); }
                        if !window.is_always_on_top().map_err(|e| e.to_string())? { return Err("completion window was not topmost".into()); }
                        let size = window.inner_size().map_err(|e| e.to_string())?;
                        let scale = window.scale_factor().map_err(|e| e.to_string())?;
                        if (size.height as f64 / scale - NOTICE_HEIGHT).abs() > 2.0 { return Err(format!("incorrect expanded window size {size:?}")); }
                        let pos = window.outer_position().map_err(|e| e.to_string())?;
                        let monitor = window.current_monitor().map_err(|e| e.to_string())?.ok_or("monitor missing")?;
                        let area = monitor.work_area();
                        if pos.y < area.position.y || pos.y + size.height as i32 > area.position.y + area.size.height as i32 { return Err("expanded reminder was outside the work area".into()); }
                        let notice = pomodoro_desktop_snapshot(handle.clone()).map_err(|e| e.message)?.notice.unwrap();
                        if notice.title != "桌面提醒验收" { return Err("native reminder lost task title".into()); }
                        update_timer(&handle, None).map_err(|e| e.message)?;
                        pomodoro_desktop_dismiss(handle.clone(), notice.id).map_err(|e| e.message)?;
                        std::thread::sleep(Duration::from_millis(300));
                        if window.is_visible().map_err(|e| e.to_string())? { return Err("dismissed inactive reminder remained visible".into()); }
                        Ok(())
                    })();
                    let _ = send.send(result);
                    handle.exit(0);
                });
                Ok(())
            }).build(context).unwrap();
        app.run_return(move |_, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                *outcome_for_thread.lock().unwrap() =
                    receive.recv_timeout(Duration::from_secs(1)).ok();
            }
        });
        outcome
            .lock()
            .unwrap()
            .take()
            .expect("desktop verification did not return")
            .unwrap();
    }
    fn notice(id: &str) -> Completion {
        Completion {
            id: id.into(),
            title: "专注".into(),
            focus: true,
            seconds: 1500,
        }
    }
    #[test]
    fn auto_cycle_updates_cannot_hide_unacknowledged_completion() {
        let mut state = DesktopState::default();
        state.complete(notice("focus"));
        state.update(Some(DesktopTimer {
            title: "短休息".into(),
            mode: "short".into(),
            ends_at: Some(2000),
            remaining: 300,
            seconds: 300,
        }));
        assert_eq!(state.snapshot().notice.unwrap().id, "focus");
        state.complete(notice("rest"));
        state.complete(notice("rest"));
        assert_eq!(state.snapshot().notice_count, 2);
        state.dismiss("focus");
        state.dismiss("focus");
        assert_eq!(state.snapshot().notice.unwrap().id, "rest");
        state.dismiss("rest");
        assert!(state.snapshot().notice.is_none());
        assert!(state.snapshot().timer.is_some());
    }
    #[test]
    fn stopped_timer_keeps_notice_until_dismissed() {
        let mut state = DesktopState::default();
        state.complete(notice("done"));
        state.update(None);
        assert!(state.snapshot().notice.is_some());
        state.dismiss("done");
        assert!(state.snapshot().timer.is_none() && state.snapshot().notice.is_none());
    }
    #[test]
    fn window_position_respects_negative_monitor_origin_and_dpi_size() {
        assert_eq!(
            clamped_position(None, (-1920, 40, 1920, 1040), (640, 360), 36),
            (-676, 684)
        );
        assert_eq!(
            clamped_position(Some((-50, 900)), (-1920, 40, 1920, 1040), (640, 360), 36),
            (-640, 720)
        );
        assert_eq!(
            clamped_position(None, (0, 0, 200, 100), (320, 180), 18),
            (0, 0)
        );
    }
}
