import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
    // Le chunk WebLLM (~6MB de runtime WASM) est déjà code-splitté via dynamic
    // import et ne se charge qu'à l'activation de l'enrichissement — le warning
    // de taille par défaut (500kB) n'est pas actionnable ici.
    chunkSizeWarningLimit: 6500,
  },
  test: {
    environment: "jsdom",
    exclude: ["e2e/**", "node_modules/**"],
  },
});
