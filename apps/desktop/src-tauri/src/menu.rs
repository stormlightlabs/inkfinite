//! Native application menu integration.

use tauri::menu::{IsMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::{AppHandle, Emitter, Runtime};

pub const FILE_MENU_EVENT: &str = "inkfinite-file-menu";

const NEW_BOARD: &str = "file.new-board";
const OPEN_BOARD: &str = "file.open-board";
const SAVE_BOARD_AS: &str = "file.save-board-as";
const IMPORT_CANVAS: &str = "file.import-canvas";
const IMPORT_SVG: &str = "file.import-svg";
const EXPORT_EXCALIDRAW: &str = "file.export-excalidraw";
const EXPORT_JSON_CANVAS: &str = "file.export-json-canvas";

/// Builds the platform-standard menu with Inkfinite document commands added to File.
pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let menu = Menu::default(app)?;
    let file_menu = menu.items()?.into_iter().find_map(|item| {
        let submenu = item.as_submenu()?;
        submenu.text().is_ok_and(|text| text == "File").then(|| submenu.clone())
    });

    if let Some(file_menu) = file_menu {
        let new_board = MenuItem::with_id(app, NEW_BOARD, "New Board", true, Some("CmdOrCtrl+N"))?;
        let open_board = MenuItem::with_id(app, OPEN_BOARD, "Open…", true, Some("CmdOrCtrl+O"))?;
        let import_canvas = MenuItem::with_id(app, IMPORT_CANVAS, "Import Editable Canvas…", true, None::<&str>)?;
        let import_svg = MenuItem::with_id(app, IMPORT_SVG, "Import SVG…", true, None::<&str>)?;
        let save_board_as = MenuItem::with_id(app, SAVE_BOARD_AS, "Save As…", true, Some("CmdOrCtrl+Shift+S"))?;
        let export_excalidraw = MenuItem::with_id(app, EXPORT_EXCALIDRAW, "Export as Excalidraw…", true, None::<&str>)?;
        let export_json_canvas = MenuItem::with_id(
            app,
            EXPORT_JSON_CANVAS,
            "Export as Obsidian Canvas…",
            true,
            None::<&str>,
        )?;
        let separator = PredefinedMenuItem::separator(app)?;
        let items: [&dyn IsMenuItem<R>; 8] = [
            &new_board,
            &open_board,
            &import_canvas,
            &import_svg,
            &save_board_as,
            &export_excalidraw,
            &export_json_canvas,
            &separator,
        ];
        file_menu.insert_items(&items, 0)?;
        log::info!("installed native File menu commands");
    } else {
        log::warn!("native File menu was unavailable; document commands were not installed");
    }

    Ok(menu)
}

/// Forwards native File menu commands to the active editor webview.
pub fn handle_event<R: Runtime>(app: &AppHandle<R>, event: tauri::menu::MenuEvent) {
    let menu_id = event.id().as_ref();
    let action = match menu_id {
        NEW_BOARD => "new",
        OPEN_BOARD => "open",
        SAVE_BOARD_AS => "save-as",
        IMPORT_CANVAS => "import",
        IMPORT_SVG => "import-svg",
        EXPORT_EXCALIDRAW => "export-excalidraw",
        EXPORT_JSON_CANVAS => "export-json-canvas",
        _ => return,
    };
    log::info!("native File menu selected: id={menu_id}, action={action}");
    if let Err(error) = app.emit(FILE_MENU_EVENT, action) {
        log::error!("failed to emit {FILE_MENU_EVENT} for {action}: {error}");
    }
}

/// Records that the renderer received a native File menu event.
#[tauri::command]
pub fn record_renderer_event(action: String) {
    log::info!("renderer received native File menu action: {action}");
}

/// Persists a renderer-side command failure alongside the native application logs.
#[tauri::command]
pub fn record_renderer_error(message: String) {
    log::error!("renderer command failure: {message}");
}
