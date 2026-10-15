use crate::{
    json_io::write_json_atomic,
    services::notes::{default_store, AppError},
};
use serde::{Deserialize, Serialize};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Condvar, Mutex, Once,
};
use tauri::Emitter;
static LOCK: Mutex<()> = Mutex::new(());
static EXITING: AtomicBool = AtomicBool::new(false);
static REMINDERS: Mutex<ReminderClock> = Mutex::new(ReminderClock { active: None });
static REMINDER_WAKE: Condvar = Condvar::new();
static REMINDER_WORKER: Once = Once::new();
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

#[derive(Clone)]
struct Reminder {
    session_id: Option<String>,
    ends_at: u64,
    focus: bool,
    sound: bool,
    title: String,
    seconds: u32,
    sent: bool,
}
struct ReminderClock {
    active: Option<Reminder>,
}
impl ReminderClock {
    fn due(&mut self, now: u64) -> Option<Reminder> {
        let reminder = self.active.as_mut()?;
        if reminder.sent || now < reminder.ends_at {
            return None;
        }
        reminder.sent = true;
        Some(reminder.clone())
    }
    fn update(&mut self, state: &State) {
        self.active = state.ends_at.map(|ends_at| {
            let focus = state.mode == "focus";
            let sent = self.active.as_ref().is_some_and(|old| {
                old.session_id == state.session_id
                    && old.ends_at == ends_at
                    && old.focus == focus
                    && old.sent
            });
            Reminder {
                session_id: state.session_id.clone(),
                ends_at,
                focus,
                sound: state.settings.sound,
                title: state
                    .session_task
                    .as_ref()
                    .map(|t| t.title.clone())
                    .unwrap_or_else(|| "专注".into()),
                seconds: state.session_seconds,
                sent,
            }
        });
    }
}
fn clock_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn deliver_reminder(app: &tauri::AppHandle, reminder: Reminder) {
    if EXITING.load(Ordering::SeqCst) {
        return;
    }
    if !play_sound(reminder.sound) {
        eprintln!("pomodoro completion sound failed");
    }
    let notice = crate::pomodoro_window::Completion {
        id: format!(
            "{}:{}",
            reminder.session_id.as_deref().unwrap_or("timer"),
            reminder.ends_at
        ),
        title: if reminder.focus {
            reminder.title
        } else {
            "休息结束".into()
        },
        focus: reminder.focus,
        seconds: reminder.seconds,
    };
    if let Err(error) = crate::pomodoro_window::complete(app, notice) {
        eprintln!("pomodoro reminder failed: {}", error.message);
        let _ = app.emit_to("main", "pomodoro://alert-error", error.message);
    }
    let _ = app.emit_to("main", "pomodoro://deadline", ());
}
fn wait_for_reminder(
    clock: &Mutex<ReminderClock>,
    wake: &Condvar,
    exiting: &AtomicBool,
) -> Option<Reminder> {
    let mut clock = clock.lock().ok()?;
    loop {
        if exiting.load(Ordering::SeqCst) {
            return None;
        }
        let now = clock_now();
        if let Some(reminder) = clock.due(now) {
            return Some(reminder);
        }
        clock = if let Some(active) = clock.active.as_ref().filter(|r| !r.sent) {
            // Recheck active sessions after clock changes or resume from sleep; idle sessions don't poll.
            let wait = active.ends_at.saturating_sub(now).clamp(1, 1000);
            wake.wait_timeout(clock, std::time::Duration::from_millis(wait))
                .ok()?
                .0
        } else {
            wake.wait(clock).ok()?
        };
    }
}
fn schedule_reminder(app: &tauri::AppHandle, state: &State) {
    let due = if let Ok(mut clock) = REMINDERS.lock() {
        // A frontend completion/pause arriving at the deadline must not cancel an unsent reminder.
        let due = clock.due(clock_now());
        clock.update(state);
        due
    } else {
        None
    };
    REMINDER_WAKE.notify_all();
    if let Some(reminder) = due {
        deliver_reminder(app, reminder);
    }
    REMINDER_WORKER.call_once(|| {
        let app = app.clone();
        std::thread::spawn(move || {
            while let Some(reminder) = wait_for_reminder(&REMINDERS, &REMINDER_WAKE, &EXITING) {
                deliver_reminder(&app, reminder);
            }
        });
    });
}

#[cfg(all(test, feature = "desktop-verification"))]
pub(super) fn start_desktop_verification(app: &tauri::AppHandle, deadline: u64) {
    // Exercise the real native deadline path without loading/saving any user timer data.
    schedule_reminder(
        app,
        &State {
            ends_at: Some(deadline),
            session_id: Some("desktop-verification".into()),
            session_task: Some(TaskLink {
                id: "verification".into(),
                title: "桌面提醒验收".into(),
            }),
            session_seconds: 60,
            settings: Settings {
                sound: true,
                ..Settings::default()
            },
            ..State::default()
        },
    );
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
    let _trash_guard = crate::recycle_bin::lock();
    let path = default_store()?.data_dir().join("番茄钟.json");
    if !path.exists() {
        return Ok(State::default());
    }
    let state: State = serde_json::from_str(&std::fs::read_to_string(path)?)?;
    validate(&state)?;
    Ok(state)
}
#[tauri::command]
pub fn pomodoro_save(app: tauri::AppHandle, state: State) -> Result<(), AppError> {
    let _lock = LOCK.lock().map_err(|_| error("计时数据锁不可用"))?;
    if EXITING.load(Ordering::SeqCst) {
        return Err(error("程序正在退出"));
    }
    validate(&state)?;
    let _trash_guard = crate::recycle_bin::lock();
    crate::recycle_bin::save_with_history(default_store()?.data_dir(), "番茄钟.json", &state)?;
    drop(_trash_guard);
    drop(_lock);
    schedule_reminder(&app, &state);
    let timer = state
        .session_id
        .as_ref()
        .map(|_| crate::pomodoro_window::DesktopTimer {
            title: if state.mode == "focus" {
                state
                    .session_task
                    .as_ref()
                    .map(|t| t.title.clone())
                    .unwrap_or_else(|| "专注".into())
            } else if state.mode == "short" {
                "短休息".into()
            } else {
                "长休息".into()
            },
            mode: state.mode.clone(),
            ends_at: state.ends_at,
            remaining: state.remaining,
            seconds: state.session_seconds,
        });
    if let Err(error) = crate::pomodoro_window::update_timer(&app, timer) {
        let _ = app.emit_to("main", "pomodoro://alert-error", error.message);
    }
    Ok(())
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
    if let Ok(mut clock) = REMINDERS.lock() {
        clock.active = None;
        REMINDER_WAKE.notify_all();
    }
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

fn play_sound(sound: bool) -> bool {
    if !sound {
        return true;
    }
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::Media::Audio::{PlaySoundA, SND_ASYNC, SND_MEMORY, SND_NODEFAULT};
        // Embedded PCM stays valid for the entire asynchronous playback; no file
        // paths, system sound scheme, browser autoplay or visible main window required.
        static CHIME: &[u8] = include_bytes!("../../src/assets/pomodoro-complete.wav");
        unsafe {
            PlaySoundA(
                CHIME.as_ptr(),
                std::ptr::null_mut(),
                SND_ASYNC | SND_MEMORY | SND_NODEFAULT,
            ) != 0
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        true
    }
}

#[tauri::command]
pub fn pomodoro_alert(app: tauri::AppHandle, focus: bool, sound: bool) -> Result<(), AppError> {
    if !play_sound(sound) {
        eprintln!("pomodoro completion sound failed");
    }
    let state = pomodoro_load()?;
    crate::pomodoro_window::complete(
        &app,
        crate::pomodoro_window::Completion {
            id: uuid::Uuid::new_v4().to_string(),
            title: if focus {
                state
                    .session_task
                    .as_ref()
                    .or(state.active_task.as_ref())
                    .map(|t| t.title.clone())
                    .unwrap_or_else(|| "专注".into())
            } else {
                "休息结束".into()
            },
            focus,
            seconds: if focus {
                state.settings.focus_minutes * 60
            } else {
                state.settings.short_minutes * 60
            },
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(all(target_os = "windows", feature = "desktop-verification"))]
    #[test]
    #[ignore = "plays the real completion chime on the desktop audio device"]
    fn real_desktop_completion_sound_can_play() {
        assert!(
            play_sound(true),
            "Windows could not start the embedded completion chime"
        );
        // Don't let the isolated test process exit before async playback finishes.
        std::thread::sleep(std::time::Duration::from_millis(1700));
    }
    #[test]
    fn native_worker_reaches_the_deadline_without_any_frontend_tick() {
        use std::sync::{mpsc, Arc};
        let shared = Arc::new((
            Mutex::new(ReminderClock { active: None }),
            Condvar::new(),
            AtomicBool::new(false),
        ));
        shared
            .0
            .lock()
            .unwrap()
            .update(&running_reminder(clock_now() + 40));
        let (send, receive) = mpsc::channel();
        let worker_state = shared.clone();
        let worker = std::thread::spawn(move || {
            while let Some(reminder) =
                wait_for_reminder(&worker_state.0, &worker_state.1, &worker_state.2)
            {
                send.send(reminder.ends_at).unwrap();
            }
        });
        receive
            .recv_timeout(std::time::Duration::from_secs(2))
            .unwrap();
        assert!(receive.try_recv().is_err());
        {
            let _guard = shared.0.lock().unwrap();
            shared.2.store(true, Ordering::SeqCst);
            shared.1.notify_all();
        }
        worker.join().unwrap();
    }
    fn running_reminder(end: u64) -> State {
        State {
            ends_at: Some(end),
            session_id: Some("session-a".into()),
            ..State::default()
        }
    }
    #[test]
    fn reminders_fire_once_even_when_the_frontend_checkpoint_arrives_at_the_deadline() {
        let state = running_reminder(1000);
        let mut clock = ReminderClock { active: None };
        clock.update(&state);
        assert!(clock.due(999).is_none());
        assert!(clock.due(1000).unwrap().focus);
        clock.update(&state);
        assert!(clock.due(1100).is_none());
        let mut rest = running_reminder(2000);
        rest.mode = "short".into();
        rest.session_id = Some("rest-a".into());
        clock.update(&rest);
        assert!(!clock.due(2000).unwrap().focus);
        assert!(clock.due(2500).is_none());
    }
    #[test]
    fn reminder_pause_resume_and_settings_changes_do_not_leak_old_alerts() {
        let mut state = running_reminder(1000);
        let mut clock = ReminderClock { active: None };
        clock.update(&state);
        state.ends_at = None;
        clock.update(&state);
        assert!(clock.due(1000).is_none());
        state.ends_at = Some(2000);
        state.settings.sound = false;
        state.settings.notification = false;
        clock.update(&state);
        assert!(clock.due(1500).is_none());
        let alert = clock.due(2000).unwrap();
        assert!(!alert.sound);
    }
    #[test]
    fn an_elapsed_reminder_is_claimed_before_frontend_completion_clears_the_session() {
        let mut clock = ReminderClock { active: None };
        clock.update(&running_reminder(1000));
        let alert = clock.due(1100);
        clock.update(&State::default());
        assert!(alert.is_some());
        assert!(clock.due(1200).is_none());
    }
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
