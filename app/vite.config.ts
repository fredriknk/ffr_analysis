import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("zrender")) return "chart-renderer";
            if (id.includes("echarts")) return "echarts";
            return "vendor";
          }
        },
      },
    },
  },
  server: { port: 1420, strictPort: true },
  envPrefix: ["VITE_", "TAURI_"],
});
