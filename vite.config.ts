import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri espera un puerto fijo y no debe limpiar la pantalla al arrancar.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  worker: { format: "es" },
  optimizeDeps: { exclude: ["@huggingface/transformers"] },
  build: { target: "es2022" },
});
