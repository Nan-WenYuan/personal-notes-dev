use crate::{
    json_io::write_json_atomic,
    services::notes::{default_store, AppError},
};
use serde::{Deserialize, Serialize};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use tauri::Manager;
static LOCK: Mutex<()> = Mutex::new(());
static EXITING: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "windows")]
static NOTIFICATION_HWND: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

pub fn clear_notification_icon() {
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::UI::Shell::{Shell_NotifyIconW, NIM_DELETE, NOTIFYICONDATAW};
        let hwnd = NOTIFICATION_HWND.swap(0, Ordering::SeqCst);
        if hwnd != 0 {
            let mut data: NOTIFYICONDATAW = unsafe { std::mem::zeroed() };
            data.cbSize = std::mem::size_of::<NOTIFYICONDATAW>() as u32;
            data.hWnd = hwnd as _;
            data.uID = 0x504f4d4f;
            unsafe {
                Shell_NotifyIconW(NIM_DELETE, &data);
            }
        }
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    focus_minutes: u32,
    short_minutes: u32,
    long_minutes: u32,
    long_every: u32,
    auto_cycle: bool,
    sound: bool,
    notification: bool,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            focus_minutes: 25,
            short_minutes: 5,
            long_minutes: 15,
            long_every: 4,
            auto_cycle: false,
            sound: true,
            notification: true,
        }
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Record {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    interrupted: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    task_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    task_title: Option<String>,
    id: String,
    started_at: u64,
    completed_at: u64,
    seconds: u32,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct TaskLink {
    id: String,
    title: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct State {
    active_task: Option<TaskLink>,
    session_task: Option<TaskLink>,
    mode: String,
    remaining: u32,
    ends_at: Option<u64>,
    started_at: Option<u64>,
    session_id: Option<String>,
    records: Vec<Record>,
    settings: Settings,
    session_seconds: u32,
    cycle_count: u32,
    last_seen: u64,
}
impl Default for State {
    fn default() -> Self {
        Self {
            mode: "focus".into(),
            active_task: None,
            session_task: None,
            remaining: 1500,
            ends_at: None,
            started_at: None,
            session_id: None,
            records: vec![],
            settings: Settings::default(),
            session_seconds: 1500,
            cycle_count: 0,
            last_seen: 0,
        }
    }
}
fn error(message: &str) -> AppError {
    AppError {
        code: "pomodoro".into(),
        message: message.into(),
        details: Default::default(),
    }
}
fn validate(state: &State) -> Result<(), AppError> {
    let s = &state.settings;
    if !matches!(state.mode.as_str(), "focus" | "short" | "long")
        || !(1..=180).contains(&s.focus_minutes)
        || !(1..=60).contains(&s.short_minutes)
        || !(1..=60).contains(&s.long_minutes)
        || !(1..=12).contains(&s.long_every)
        || state.remaining > 10800
        || !(60..=10800).contains(&state.session_seconds)
        || state.records.iter().any(|r| {
            r.id.is_empty()
                || !(if r.interrupted == Some(true) { 1 } else { 60 }..=10800).contains(&r.seconds)
                || r.completed_at < r.started_at
        })
    {
        return Err(error("无效的番茄钟设置或记录"));
    }
    Ok(())
}
#[tauri::command]
pub fn pomodoro_load() -> Result<State, AppError> {
    let _lock = LOCK.lock().map_err(|_| error("计时数据锁不可用"))?;
    let path = default_store()?.data_dir().join("番茄钟.json");
    if !path.exists() {
        return Ok(State::default());
    }
    let state: State = serde_json::from_str(&std::fs::read_to_string(path)?)?;
    validate(&state)?;
    Ok(state)
}
#[tauri::command]
pub fn pomodoro_save(state: State) -> Result<(), AppError> {
    let _lock = LOCK.lock().map_err(|_| error("计时数据锁不可用"))?;
    if EXITING.load(Ordering::SeqCst) {
        return Err(error("程序正在退出"));
    }
    validate(&state)?;
    write_json_atomic(&default_store()?.data_dir().join("番茄钟.json"), &state)
}
fn pause(state: &mut State, now: u64) {
    if let Some(end) = state.ends_at {
        if now >= end && state.mode == "focus" {
            if let (Some(id), Some(start)) = (&state.session_id, state.started_at) {
                if !state.records.iter().any(|r| r.id == *id) {
                    state.records.push(Record {
                        interrupted: None,
                        task_id: state.session_task.as_ref().map(|t| t.id.clone()),
                        task_title: state.session_task.as_ref().map(|t| t.title.clone()),
                        id: id.clone(),
                        started_at: start,
                        completed_at: end,
                        seconds: state.session_seconds,
                    });
                    state.cycle_count += 1;
                }
            }
        }
        state.remaining = ((end.saturating_sub(now) + 999) / 1000) as u32;
        state.ends_at = None;
        if state.remaining == 0 {
            state.session_id = None;
            state.started_at = None;
        }
        state.last_seen = now;
    }
}
pub fn pause_on_exit() -> Result<(), AppError> {
    let _lock = LOCK.lock().map_err(|_| error("计时数据锁不可用"))?;
    EXITING.store(true, Ordering::SeqCst);
    let path = default_store()?.data_dir().join("番茄钟.json");
    if !path.exists() {
        return Ok(());
    }
    let mut state: State = serde_json::from_str(&std::fs::read_to_string(&path)?)?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| error("无效的系统时间"))?
        .as_millis() as u64;
    pause(&mut state, now);
    write_json_atomic(&path, &state)
}

#[tauri::command]
pub fn pomodoro_alert(
    app: tauri::AppHandle,
    focus: bool,
    sound: bool,
    notification: bool,
) -> Result<(), AppError> {
    let message = if focus {
        "本次专注已完成，休息一下吧"
    } else {
        "休息结束，可以开始下一次专注了"
    };
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::UI::{
            Shell::{
                Shell_NotifyIconW, NIF_ICON, NIF_INFO, NIF_TIP, NIIF_INFO, NIIF_NOSOUND, NIM_ADD,
                NIM_DELETE, NIM_SETVERSION, NOTIFYICONDATAW, NOTIFYICON_VERSION_4,
            },
            WindowsAndMessaging::{LoadIconW, IDI_INFORMATION, MB_ICONASTERISK},
        };
        if sound {
            unsafe {
                windows_sys::Win32::System::Diagnostics::Debug::MessageBeep(MB_ICONASTERISK);
            }
        }
        if notification {
            let window = app
                .get_webview_window("main")
                .ok_or_else(|| error("主窗口不可用"))?;
            let hwnd = window.hwnd().map_err(|_| error("无法获取通知窗口"))?.0 as usize;
            let mut data: NOTIFYICONDATAW = unsafe { std::mem::zeroed() };
            data.cbSize = std::mem::size_of::<NOTIFYICONDATAW>() as u32;
            data.hWnd = hwnd as _;
            data.uID = 0x504f4d4f;
            data.uFlags = NIF_ICON | NIF_INFO | NIF_TIP;
            data.hIcon = unsafe { LoadIconW(std::ptr::null_mut(), IDI_INFORMATION) };
            data.dwInfoFlags = NIIF_INFO | NIIF_NOSOUND;
            for (to, from) in data
                .szInfoTitle
                .iter_mut()
                .zip("花笺 · 番茄钟".encode_utf16())
            {
                *to = from;
            }
            for (to, from) in data.szTip.iter_mut().zip("花笺 · 专注提醒".encode_utf16()) {
                *to = from;
            }
            for (to, from) in data.szInfo.iter_mut().zip(message.encode_utf16()) {
                *to = from;
            }
            unsafe {
                Shell_NotifyIconW(NIM_DELETE, &data);
                if Shell_NotifyIconW(NIM_ADD, &data) == 0 {
                    return Err(error("系统通知发送失败"));
                }
                data.Anonymous.uVersion = NOTIFYICON_VERSION_4;
                Shell_NotifyIconW(NIM_SETVERSION, &data);
            }
            NOTIFICATION_HWND.store(hwnd, Ordering::SeqCst);
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(15));
                let mut data: NOTIFYICONDATAW = unsafe { std::mem::zeroed() };
                data.cbSize = std::mem::size_of::<NOTIFYICONDATAW>() as u32;
                data.hWnd = hwnd as _;
                data.uID = 0x504f4d4f;
                unsafe {
                    Shell_NotifyIconW(NIM_DELETE, &data);
                }
            });
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (message, sound);
        if notification {
            if let Some(window) = app.get_webview_window("main") {
                let _ =
                    window.request_user_attention(Some(tauri::UserAttentionType::Informational));
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exit_pauses_without_counting_unfinished_session() {
        let mut s = State {
            ends_at: Some(100000),
            started_at: Some(1),
            session_id: Some("one".into()),
            ..Default::default()
        };
        pause(&mut s, 70000);
        assert_eq!(s.remaining, 30);
        assert!(s.ends_at.is_none());
        assert!(s.records.is_empty());
        assert!(s.session_id.is_some());
    }
    #[test]
    fn exit_counts_finished_focus_once_and_never_rest() {
        let mut s = State {
            ends_at: Some(100000),
            started_at: Some(1),
            session_id: Some("one".into()),
            ..Default::default()
        };
        pause(&mut s, 100001);
        pause(&mut s, 200000);
        assert_eq!(s.records.len(), 1);
        let mut rest = State {
            mode: "short".into(),
            ends_at: Some(1000),
            ..Default::default()
        };
        pause(&mut rest, 2000);
        assert!(rest.records.is_empty());
    }
    #[test]
    fn old_data_loads_with_default_settings() {
        let s:State=serde_json::from_str(r#"{"mode":"focus","remaining":900,"endsAt":null,"startedAt":null,"sessionId":null,"records":[]}"#).unwrap();
        validate(&s).unwrap();
        assert_eq!(s.settings.long_every, 4);
    }
    #[test]
    fn linked_task_survives_serialization_and_exit_completion() {
        let mut s = State {
            ends_at: Some(1000),
            started_at: Some(1),
            session_id: Some("linked".into()),
            session_task: Some(TaskLink {
                id: "task".into(),
                title: "原名称".into(),
            }),
            ..Default::default()
        };
        pause(&mut s, 1001);
        let loaded: State = serde_json::from_str(&serde_json::to_string(&s).unwrap()).unwrap();
        assert_eq!(loaded.records[0].task_id.as_deref(), Some("task"));
        assert_eq!(loaded.records[0].task_title.as_deref(), Some("原名称"));
    }
    #[test]
    fn rejects_bad_settings_and_records() {
        let mut s = State::default();
        s.settings.focus_minutes = 0;
        assert!(validate(&s).is_err());
        s.settings.focus_minutes = 30;
        assert!(validate(&s).is_ok());
        s.records.push(Record {
            interrupted: None,
            task_id: None,
            task_title: None,
            id: "one".into(),
            started_at: 5,
            completed_at: 4,
            seconds: 1800,
        });
        assert!(validate(&s).is_err());
    }
    #[test]
    fn interrupted_record_roundtrips_and_accepts_partial_minutes() {
        let mut s = State::default();
        s.records.push(Record {
            interrupted: Some(true),
            task_id: Some("task".into()),
            task_title: None,
            id: "partial".into(),
            started_at: 1,
            completed_at: 20001,
            seconds: 20,
        });
        validate(&s).unwrap();
        let loaded: State = serde_json::from_str(&serde_json::to_string(&s).unwrap()).unwrap();
        assert_eq!(loaded.records[0].interrupted, Some(true));
        assert_eq!(loaded.records[0].seconds, 20);
        s.records[0].interrupted = None;
        assert!(validate(&s).is_err());
    }
}
