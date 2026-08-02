mod files;
mod ipc;
mod menu;
mod session;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::new().level(log::LevelFilter::Debug).build())
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
            log::info!("desktop application setup completed");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            session::create_document,
            session::open_document,
            session::open_or_create_draft,
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
            session::save_draft_as,
            session::query,
            session::validate,
            session::sync_connect,
            session::sync_disconnect,
            session::sync_next,
            session::sync_receive,
            session::close,
            files::read_directory,
            files::pick_open_document,
            files::pick_save_document,
            files::pick_interchange_document,
            files::save_interchange_document,
            files::rename_file,
            files::delete_file,
            files::pick_workspace_directory,
            menu::record_renderer_event,
            menu::record_renderer_error
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
