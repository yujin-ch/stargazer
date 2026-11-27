import { defineConfig, type Plugin } from "vite";
import { readFile } from "node:fs/promises";

/** /api/night for `vite` and `vite preview` on this computer: every night is open locally (for checking packs). */
const localNights = (): Plugin => {
  const serve = (server: { middlewares: { use: (fn: (req: { url?: string }, res: { statusCode: number; setHeader: (k: string, v: string) => void; end: (b?: string) => void }, next: () => void) => void) => void } }) => {
    server.middlewares.use((req, res, next) => {
      const m = /^\/api\/night\?date=(\d{4}-\d{2}-\d{2})/.exec(req.url ?? "");
      if (!m) return next();
      readFile(`packs/${m[1]}.json`, "utf8")
        .then((b) => { res.setHeader("Content-Type", "application/json"); res.end(b); })
        .catch(() => { res.statusCode = 404; res.setHeader("Content-Type", "application/json"); res.end('{"error":"no pack"}'); });
    });
  };
  return { name: "local-nights", configureServer: serve, configurePreviewServer: serve };
};

export default defineConfig({
  plugins: [localNights()],
  build: { rollupOptions: { input: { main: "index.html", board: "board.html" } } },
  // true only on Vercel preview deployments (branches other than main), which can preview future nights
  define: { __PREVIEW__: JSON.stringify(process.env.VERCEL_ENV === "preview" || (process.env.CF_PAGES === "1" && !!process.env.CF_PAGES_BRANCH && process.env.CF_PAGES_BRANCH !== "main")) },
});
