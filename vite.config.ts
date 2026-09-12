import { defineConfig } from "vite";
import path from "node:path";

// GitHub Pages project sites are served from https://<owner>.github.io/<repo>/,
// so a Pages build needs the repository name as its base path. Local dev and
// preview keep the root base so the server stays at http://localhost:5173/.
const repository = process.env.GITHUB_REPOSITORY?.split("/")[1];
const base = process.env.GITHUB_ACTIONS === "true" && repository ? `/${repository}/` : "/";

export default defineConfig({
  base,
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  server: {
    port: 5173,
    open: false,
  },
  build: {
    target: "esnext",
    sourcemap: true,
  },
});
