// La app de escritorio reutiliza el mismo editor web dentro de WebView2 (Chromium),
// así que WebCodecs, Web Audio e IndexedDB funcionan igual que en el navegador.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("no se pudo iniciar Montaje");
}
