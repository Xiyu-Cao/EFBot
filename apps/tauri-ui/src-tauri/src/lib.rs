use tauri::Manager;

/// Called from JavaScript via Tauri's invoke() API.
/// Provides a native bridge for operations that require OS access.
#[tauri::command]
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![get_app_version])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
