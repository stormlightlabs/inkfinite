mod files;
mod ipc;
mod menu;
mod session;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .menu(menu::build)
        .on_menu_event(menu::handle_event)
        .manage(session::DesktopState::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(|app| {
            let service = app.state::<session::DesktopState>().service_handle();
            let server = tauri::async_runtime::block_on(ipc::start(app.handle().clone(), service))?;
            app.manage(server);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            session::create_document,
            session::open_document,
            session::snapshot,
            session::commit,
            session::propose,
            session::accept_proposal,
            session::reject_proposal,
            session::authorize_apply,
            session::undo,
            session::redo,
            session::save,
            session::save_as,
            session::query,
            session::validate,
            session::sync_connect,
            session::sync_disconnect,
            session::sync_next,
            session::sync_receive,
            session::close,
            files::read_directory,
            files::rename_file,
            files::delete_file,
            files::pick_workspace_directory
        ]);
    let app = builder
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            if let Some(server) = app_handle.try_state::<ipc::IpcServerHandle>() {
                server.stop();
            }
        }
    });
}
