import { defineConfig } from "vite";
export default defineConfig({
  build: { rollupOptions: { input: { main: "index.html", board: "board.html" } } },
  // true only on Vercel preview deployments (branches other than main), which can preview future nights
  define: { __PREVIEW__: JSON.stringify(process.env.VERCEL_ENV === "preview") },
});
