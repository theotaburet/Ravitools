import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

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
    // import et ne se charge qu'à l'activation de l'enrichissement : le warning
    // de taille par défaut (500kB) n'est pas actionnable ici.
    chunkSizeWarningLimit: 6500,
  },
  test: {
    environment: "jsdom",
    exclude: ["e2e/**", "node_modules/**"],
    // Vitest blanks CSS; let `?raw` through so palettes.test.ts reads the real tokens
    css: { include: [/\.css\?raw$/] },
    // A test without an assertion passes silently
    expect: { requireAssertions: true },
    // Node 25 turns Web Storage on and warns in every worker (no --localstorage-file);
    // jsdom brings its own localStorage. Older Node rejects the flag.
    execArgv:
      Number(process.versions.node.split(".")[0]) >= 25 ? ["--no-experimental-webstorage"] : [],
  },
});
