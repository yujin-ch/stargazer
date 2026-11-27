import { describe, expect, test } from "vitest";
import { execSync } from "node:child_process";

execSync("node scripts/cf/gen-packs.mjs");
const { onRequestGet } = await import("../functions/api/night");
const get = (q: string, env = {}) => onRequestGet({ request: new Request(`https://x/api/night?${q}`), env });

describe("night API on Cloudflare Pages", () => {
  test("a started night is served, a future one is not", async () => {
    const ok = await get("date=2026-11-26");
    expect(ok.status).toBe(200);
    expect((await ok.json()).items.length).toBeGreaterThan(0);
    expect((await get("date=2099-01-01")).status).toBe(404);
    expect((await get("date=../../etc")).status).toBe(400);
  });
  test("no early nights without an admin token, even with admins configured", async () => {
    expect((await get("date=2099-01-01", { ADMIN_EMAILS: "a@b.c", SUPABASE_URL: "https://s", SUPABASE_ANON_KEY: "k" })).status).toBe(404);
  });
});
