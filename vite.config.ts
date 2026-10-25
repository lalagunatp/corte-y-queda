import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri espera un puerto fijo y no debe limpiar la pantalla al arrancar.
// La base relativa permite publicar en GitHub Pages bajo /<repositorio>/ sin configurar el nombre.
export default defineConfig({
  base: "./",
  plugins: [react()],
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  worker: { format: "es" },
  optimizeDeps: { exclude: ["@huggingface/transformers"] },
  build: { target: "es2022" },
});
