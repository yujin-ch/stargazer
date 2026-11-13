// Single-file build of the drawing board page (for the Claude preview artifact).
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
export default defineConfig({
  plugins: [viteSingleFile()],
  build: { outDir: "dist-board", assetsInlineLimit: 100_000_000, rollupOptions: { input: "board.html" } },
});
