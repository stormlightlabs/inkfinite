mod files;
mod session;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(session::DesktopState::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            session::create_document,
            session::open_document,
            session::snapshot,
            session::commit,
            session::undo,
            session::redo,
            session::save,
            session::save_as,
            session::query,
            session::validate,
            session::close,
            files::read_directory,
            files::rename_file,
            files::delete_file,
            files::pick_workspace_directory
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
