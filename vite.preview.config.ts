// Builds a single self-contained HTML file (used for the Claude preview artifact).
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
export default defineConfig({
  plugins: [viteSingleFile()],
  define: { "import.meta.env.VITE_PREVIEW_TOOLS": JSON.stringify("1") },
  build: { outDir: "dist-single", assetsInlineLimit: 100_000_000 },
});
