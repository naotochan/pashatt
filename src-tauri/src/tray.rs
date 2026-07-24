use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::TrayIconBuilder,
    AppHandle,
};

const TRAY_ID: &str = "main";

pub fn setup_tray(app: &AppHandle) -> Result<(), tauri::Error> {
    let menu = build_menu(app)?;
    let tray_icon = Image::from_bytes(include_bytes!("../icons/tray-icon.png"))?;

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(tray_icon)
        .icon_as_template(true)
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| {
            let id = event.id.as_ref();
            match id {
                "screenshot" => {
                    let app = app.clone();
                    tauri::async_runtime::spawn(async move {
                        crate::trigger_capture(&app).await;
                    });
                }
                "settings" => {
                    crate::show_settings_window(app);
                }
                "check_updates" => {
                    let app = app.clone();
                    tauri::async_runtime::spawn(async move {
                        crate::updater::check_for_updates(&app, true).await;
                    });
                }
                "history_clear" => {
                    if let Err(e) = crate::history::clear() {
                        eprintln!("[history] clear failed: {e}");
                    }
                    refresh_menu(app);
                }
                "quit" => {
                    app.exit(0);
                }
                other if other.starts_with("history:") => {
                    let hist_id = &other["history:".len()..];
                    crate::copy_history_item(app, hist_id);
                }
                _ => {}
            }
        })
        .build(app)?;

    Ok(())
}

/// 履歴更新後にトレイメニューを差し替える
pub fn refresh_menu(app: &AppHandle) {
    match build_menu(app) {
        Ok(menu) => {
            if let Some(tray) = app.tray_by_id(TRAY_ID) {
                if let Err(e) = tray.set_menu(Some(menu)) {
                    eprintln!("[tray] set_menu failed: {e}");
                }
            }
        }
        Err(e) => eprintln!("[tray] build_menu failed: {e}"),
    }
}

fn build_menu(app: &AppHandle) -> Result<Menu<tauri::Wry>, tauri::Error> {
    let screenshot = MenuItem::with_id(app, "screenshot", "スクリーンショット", true, None::<&str>)?;
    let history_submenu = build_history_submenu(app)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let settings = MenuItem::with_id(app, "settings", "設定...", true, None::<&str>)?;
    let check_updates = MenuItem::with_id(
        app,
        "check_updates",
        "Check for Updates…",
        true,
        None::<&str>,
    )?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "終了", true, None::<&str>)?;

    Menu::with_items(
        app,
        &[
            &screenshot,
            &history_submenu,
            &sep1,
            &settings,
            &check_updates,
            &sep2,
            &quit,
        ],
    )
}

fn build_history_submenu(app: &AppHandle) -> Result<Submenu<tauri::Wry>, tauri::Error> {
    let entries = crate::history::list();

    if entries.is_empty() {
        let empty = MenuItem::with_id(app, "history_empty", "履歴なし", false, None::<&str>)?;
        return Submenu::with_id_and_items(app, "history", "履歴", true, &[&empty]);
    }

    let mut entry_items: Vec<MenuItem<tauri::Wry>> = Vec::with_capacity(entries.len().min(20));
    for entry in entries.iter().take(20) {
        let title = format!("{}  ({}×{})", entry.label, entry.width, entry.height);
        entry_items.push(MenuItem::with_id(
            app,
            format!("history:{}", entry.id),
            title,
            true,
            None::<&str>,
        )?);
    }

    let sep = PredefinedMenuItem::separator(app)?;
    let clear = MenuItem::with_id(app, "history_clear", "履歴をクリア", true, None::<&str>)?;

    let mut refs: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> =
        Vec::with_capacity(entry_items.len() + 2);
    for item in &entry_items {
        refs.push(item);
    }
    refs.push(&sep);
    refs.push(&clear);

    Submenu::with_id_and_items(app, "history", "履歴", true, &refs)
}
