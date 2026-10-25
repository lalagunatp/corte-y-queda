// La app de escritorio reutiliza el mismo editor web dentro de WebView2 (Chromium),
// así que WebCodecs, Web Audio e IndexedDB funcionan igual que en el navegador.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Abre los enlaces externos (bibliotecas de música) en el navegador del sistema.
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("no se pudo iniciar Corte y Queda");
}
