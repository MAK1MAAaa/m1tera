mod auth;
mod network;
mod runtime;

use runtime::{runtime_request, RuntimeBridge};
use tauri::Manager;

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(RuntimeBridge::default())
        .invoke_handler(tauri::generate_handler![
            runtime_request,
            auth::open_auth_url,
            auth::open_external_url
        ])
        .build(tauri::generate_context!())
        .expect("Failed to create the desktop application");

    app.run(|app, event| match event {
        tauri::RunEvent::ExitRequested { api, .. } => {
            let bridge = app.state::<RuntimeBridge>();
            if !bridge.shutdown_complete() {
                // A second Quit request must not bypass cancellation already in progress.
                api.prevent_exit();
                if bridge.begin_shutdown() {
                    let app = app.clone();
                    let bridge = bridge.inner().clone();
                    tauri::async_runtime::spawn(async move {
                        bridge.shutdown().await;
                        app.exit(0);
                    });
                }
            }
        }
        tauri::RunEvent::Exit => app.state::<RuntimeBridge>().terminate(),
        _ => {}
    });
}
