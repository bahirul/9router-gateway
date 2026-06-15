import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: directory,
  plugins: [react(), tailwindcss()],
  build: {
    outDir: path.join(directory, "dist"),
    emptyOutDir: true,
    rolldownOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/recharts") || id.includes("node_modules/d3-")) {
            return "charts";
          }
          if (id.includes("node_modules/react") || id.includes("node_modules/scheduler")) {
            return "react";
          }
          return undefined;
        },
      },
    },
  },
  server: {
    port: 20130,
    proxy: {
      "/api": "http://127.0.0.1:20129",
      "/healthz": "http://127.0.0.1:20129",
      "/readyz": "http://127.0.0.1:20129",
    },
  },
});
