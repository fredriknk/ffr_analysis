#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod commands;
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(commands::AppState::default())
        .invoke_handler(commands::handlers())
        .run(tauri::generate_context!())
        .expect("could not start FFR Analyzer");
}
