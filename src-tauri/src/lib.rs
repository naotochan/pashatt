mod capture;
mod config;
mod history;
mod tray;
mod updater;

use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, RunEvent, State};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

// macOS: アクセシビリティ権限チェック (CGEventTap に必要)
#[cfg(target_os = "macos")]
#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXIsProcessTrusted() -> u8;
}

#[cfg(target_os = "macos")]
fn accessibility_trusted() -> bool {
    unsafe { AXIsProcessTrusted() != 0 }
}

#[cfg(not(target_os = "macos"))]
fn accessibility_trusted() -> bool {
    true
}

pub struct AppState {
    pub settings: Mutex<config::AppSettings>,
}

// ============================================================
// Tauriコマンド
// ============================================================

#[tauri::command]
fn get_settings(state: State<AppState>) -> config::AppSettings {
    state.settings.lock().unwrap_or_else(|e| e.into_inner()).clone()
}

#[tauri::command]
fn save_settings(
    state: State<AppState>,
    app: AppHandle,
    settings: config::AppSettings,
) -> Result<(), String> {
    config::save_settings(&settings)?;
    let mut s = state.settings.lock().unwrap_or_else(|e| e.into_inner());
    *s = settings.clone();
    drop(s);
    let _ = register_hotkeys(&app, &settings.hotkeys);
    Ok(())
}

#[tauri::command]
async fn show_overlay(app: AppHandle) -> Result<(), String> {
    show_overlay_window(&app);
    Ok(())
}

#[tauri::command]
async fn hide_overlay(app: AppHandle) -> Result<(), String> {
    hide_overlay_hard(&app);
    set_accessory_policy(&app);
    Ok(())
}

/// alwaysOnTop 透過窓は hide だけでは残像が残ることがあるので、先に alwaysOnTop を外す
fn hide_overlay_hard(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("overlay") {
        let _ = win.set_always_on_top(false);
        let _ = win.hide();
    }
}

fn hide_for_capture(app: &AppHandle) {
    hide_overlay_hard(app);
    if let Some(editor) = app.get_webview_window("editor") {
        let _ = editor.hide();
    }
}

/// NSPasteboard はメインスレッド専用。tokio ワーカーから直接 arboard すると失敗／空振りする。
fn copy_image_on_main_thread(app: &AppHandle, path: &std::path::Path) -> Result<(), String> {
    let path = path.to_path_buf();
    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let result = capture::copy_image_to_clipboard(&path);
        let _ = tx.send(result);
    })
    .map_err(|e| format!("run_on_main_thread: {}", e))?;
    rx.recv()
        .map_err(|e| format!("clipboard channel: {}", e))?
}

/// キャプチャ成功後: クリップボードへコピー → 履歴保存 → エディタを開く
fn finish_capture(app: &AppHandle, path: &std::path::Path) -> Result<(), String> {
    // キャプチャ待ちのあいだに残像が出ないよう再 hide
    hide_overlay_hard(app);

    if let Err(e) = copy_image_on_main_thread(app, path) {
        eprintln!("[clipboard] auto-copy failed: {}", e);
    }
    let (b64, w, h) = capture::load_as_base64(path)?;
    if let Err(e) = history::add_capture(path, w, h) {
        eprintln!("[history] save failed: {}", e);
    } else {
        tray::refresh_menu(app);
    }
    open_editor_with_image(app, b64, w, h);
    Ok(())
}

pub fn copy_history_item(app: &AppHandle, id: &str) {
    match history::path_for_id(id) {
        Some(path) => {
            if let Err(e) = copy_image_on_main_thread(app, &path) {
                eprintln!("[history] copy failed: {e}");
            }
        }
        None => eprintln!("[history] item not found: {id}"),
    }
}

#[tauri::command]
async fn capture_region(
    app: AppHandle,
    state: State<'_, AppState>,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<(), String> {
    let show_cursor = state.settings.lock().unwrap_or_else(|e| e.into_inner()).show_cursor;
    hide_for_capture(&app);
    let path = capture::capture_region(x, y, width, height, show_cursor).await?;
    finish_capture(&app, &path)
}

#[tauri::command]
async fn do_capture_fullscreen(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let show_cursor = state.settings.lock().unwrap_or_else(|e| e.into_inner()).show_cursor;
    hide_for_capture(&app);
    let path = capture::capture_fullscreen(show_cursor).await?;
    finish_capture(&app, &path)
}

#[tauri::command]
async fn get_window_list() -> Vec<capture::WindowInfo> {
    capture::get_window_list().await
}

#[tauri::command]
async fn capture_window_by_id(app: AppHandle, state: State<'_, AppState>, window_id: u32) -> Result<(), String> {
    let show_cursor = state.settings.lock().unwrap_or_else(|e| e.into_inner()).show_cursor;
    hide_for_capture(&app);
    let path = capture::capture_window_by_id(window_id, show_cursor).await?;
    finish_capture(&app, &path)
}

#[tauri::command]
async fn copy_to_clipboard(app: AppHandle, base64_data: String, ext: String) -> Result<(), String> {
    // ext をホワイトリスト検証
    if ext != "png" && ext != "jpg" {
        return Err(format!("unsupported format: {}", ext));
    }

    let bytes = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        &base64_data,
    )
    .map_err(|e| format!("base64 decode error: {}", e))?;

    let tmp = std::env::temp_dir().join(format!("pashatt_export.{}", ext));
    std::fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    copy_image_on_main_thread(&app, &tmp)
}

#[tauri::command]
async fn save_image(base64_data: String, path: String) -> Result<(), String> {
    capture::save_base64_to_file(&base64_data, &path)
}

#[tauri::command]
fn check_screen_permission() -> bool {
    capture::check_screen_permission()
}

#[tauri::command]
fn check_accessibility_permission() -> bool {
    accessibility_trusted()
}

#[tauri::command]
fn open_system_preferences(_app: AppHandle) {
    // macOS 13+ System Settings URL（旧 Security ペイン URL は Sequoia 以降で届かないことがある）
    let _ = std::process::Command::new("open")
        .arg("x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_ScreenCapture")
        .spawn();
}

#[tauri::command]
fn open_accessibility_preferences(_app: AppHandle) {
    let _ = std::process::Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
        .spawn();
}

#[tauri::command]
async fn check_for_updates_cmd(app: AppHandle) -> Result<(), String> {
    updater::check_for_updates(&app, true).await;
    Ok(())
}

// ============================================================
// ヘルパー
// ============================================================

#[cfg(target_os = "macos")]
fn set_accessory_policy(app: &AppHandle) {
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);
}

#[cfg(not(target_os = "macos"))]
fn set_accessory_policy(_app: &AppHandle) {}

#[cfg(target_os = "macos")]
fn set_regular_policy(app: &AppHandle) {
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
}

#[cfg(not(target_os = "macos"))]
fn set_regular_policy(_app: &AppHandle) {}

#[tauri::command]
fn editor_hidden(app: AppHandle) {
    set_accessory_policy(&app);
}

fn open_editor_with_image(app: &AppHandle, b64: String, width: u32, height: u32) {
    hide_overlay_hard(app);
    // Accessory のままだと前面に出ず他ウィンドウの裏に回る
    set_regular_policy(app);
    if let Some(win) = app.get_webview_window("editor") {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
        let payload = serde_json::json!({
            "image_base64": b64,
            "width": width,
            "height": height,
        });
        let _ = win.emit("capture-complete", payload);
    }
}

/// ホットキーを登録する (単一キー: screenshot)
fn register_hotkeys(
    app: &AppHandle,
    hotkeys: &config::HotkeyConfig,
) -> Result<(), String> {
    let _ = app.global_shortcut().unregister_all();

    let key_str = hotkeys.screenshot.clone();
    let app_clone = app.clone();

    match key_str.parse::<Shortcut>() {
        Ok(shortcut) => {
            app.global_shortcut()
                .on_shortcut(shortcut, move |_app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        let app2 = app_clone.clone();
                        tauri::async_runtime::spawn(async move {
                            trigger_capture(&app2).await;
                        });
                    }
                })
                .map_err(|e| format!("shortcut register error for '{}': {}", key_str, e))?;
            eprintln!("[hotkey] registered: '{}'", key_str);
        }
        Err(e) => {
            eprintln!("[hotkey] parse failed for '{}': {:?}", key_str, e);
        }
    }
    Ok(())
}

/// オーバーレイをプライマリモニターにフィットさせる
fn fit_overlay_to_screen(app: &AppHandle, win: &tauri::WebviewWindow) {
    if let Ok(Some(monitor)) = app.primary_monitor() {
        let size = monitor.size();
        let scale = monitor.scale_factor();
        let w = size.width as f64 / scale;
        let h = size.height as f64 / scale;
        let _ = win.set_size(tauri::LogicalSize::new(w, h));
        let _ = win.set_position(tauri::LogicalPosition::new(0.0, 0.0));
    }
}

/// オーバーレイを前面に出し、キー入力を受け取れる状態にする
fn show_overlay_window(app: &AppHandle) {
    // Accessory のままだと最初のクリックがアクティベート専用で消費されがち。
    set_regular_policy(app);
    if let Some(win) = app.get_webview_window("overlay") {
        fit_overlay_to_screen(app, &win);
        let _ = win.set_always_on_top(true);
        let _ = win.show();
        let _ = win.set_focus();
    }
}

/// 統合オーバーレイを表示する
pub async fn trigger_capture(app: &AppHandle) {
    // エディタが表示中なら隠す（スクショに写り込み防止）
    if let Some(editor) = app.get_webview_window("editor") {
        let _ = editor.hide();
    }
    show_overlay_window(app);
}

pub fn show_settings_window(app: &AppHandle) {
    set_regular_policy(app);
    if let Some(win) = app.get_webview_window("settings") {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
    }
}

// ============================================================
// エントリポイント
// ============================================================

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let settings = config::load_settings();

    let mut builder = tauri::Builder::default();

    // 二重起動防止（他プラグインより先に登録）
    #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_settings_window(app);
        }));
    }

    builder
        .manage(AppState {
            settings: Mutex::new(settings),
        })
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            {
                app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            }

            // タイトルバーにバージョンを表示（設定・エディタ）
            let titled = format!("Pashatt {}", env!("CARGO_PKG_VERSION"));
            for label in ["settings", "editor"] {
                if let Some(win) = app.get_webview_window(label) {
                    let _ = win.set_title(&titled);
                }
            }

            tray::setup_tray(&app.handle())?;

            let settings = app.state::<AppState>().settings.lock().unwrap_or_else(|e| e.into_inner()).clone();
            if let Err(e) = register_hotkeys(&app.handle(), &settings.hotkeys) {
                eprintln!("Hotkey registration error: {}", e);
            }

            // 起動時にサイレント更新チェック（差分があればダイアログ）
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                updater::check_for_updates(&app_handle, false).await;
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_settings,
            show_overlay,
            hide_overlay,
            capture_region,
            do_capture_fullscreen,
            get_window_list,
            capture_window_by_id,
            copy_to_clipboard,
            save_image,
            check_screen_permission,
            check_accessibility_permission,
            open_system_preferences,
            open_accessibility_preferences,
            check_for_updates_cmd,
            editor_hidden,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // macOS: Dock / Finder から再オープンされたとき設定を前面に
            if let RunEvent::Reopen {
                has_visible_windows,
                ..
            } = event
            {
                if !has_visible_windows {
                    show_settings_window(app);
                }
            }
        });
}
