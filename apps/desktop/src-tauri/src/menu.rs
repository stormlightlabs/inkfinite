//! Native application menu integration.

use tauri::menu::{IsMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::{AppHandle, Emitter, Runtime};

pub const FILE_MENU_EVENT: &str = "inkfinite-file-menu";

const NEW_BOARD: &str = "file.new-board";
const OPEN_BOARD: &str = "file.open-board";
const SAVE_BOARD_AS: &str = "file.save-board-as";

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
        let save_board_as = MenuItem::with_id(app, SAVE_BOARD_AS, "Save As…", true, Some("CmdOrCtrl+Shift+S"))?;
        let separator = PredefinedMenuItem::separator(app)?;
        let items: [&dyn IsMenuItem<R>; 4] = [&new_board, &open_board, &save_board_as, &separator];
        file_menu.insert_items(&items, 0)?;
    }

    Ok(menu)
}

/// Forwards native File menu commands to the active editor webview.
pub fn handle_event<R: Runtime>(app: &AppHandle<R>, event: tauri::menu::MenuEvent) {
    let action = match event.id().as_ref() {
        NEW_BOARD => "new",
        OPEN_BOARD => "open",
        SAVE_BOARD_AS => "save-as",
        _ => return,
    };
    let _ = app.emit(FILE_MENU_EVENT, action);
}
