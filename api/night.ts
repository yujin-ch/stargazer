/**
 * One night's pack (names, bands, notes, picture file names):  GET /api/night?date=YYYY-MM-DD
 *
 * A night is handed out once it has started somewhere on Earth (the first places to reach a date are 14 hours ahead
 * of UTC), so tomorrow's answers can't be read early. Before that it's only given to:
 *   - preview deployments (VERCEL_ENV=preview), which Vercel already keeps private to the team, and
 *   - signed-in admins: a Supabase access token whose email is in ADMIN_EMAILS (comma separated).
 * Packs live in packs/<date>.json, outside the public folder (bundled with this function via vercel.json).
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

declare const process: { env: Record<string, string | undefined>; cwd(): string };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The latest calendar date anywhere on Earth right now (UTC+14). */
export function latestDateOnEarth(now = Date.now()): string {
  return new Date(now + 14 * 3600 * 1000).toISOString().slice(0, 10);
}

const json = (body: unknown, status: number, cache: string) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": cache } });

/** Is this request from a signed-in admin? Checks the token with Supabase itself. */
async function isAdmin(req: Request): Promise<boolean> {
  const admins = (process.env.ADMIN_EMAILS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL, key = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
  const auth = req.headers.get("authorization") ?? "";
  if (!admins.length || !url || !key || !auth.startsWith("Bearer ")) return false;
  try {
    const r = await fetch(`${url}/auth/v1/user`, { headers: { apikey: key, Authorization: auth } });
    if (!r.ok) return false;
    const u = (await r.json()) as { email?: string; email_confirmed_at?: string | null };
    return !!u.email && !!u.email_confirmed_at && admins.includes(u.email.toLowerCase());
  } catch {
    return false;
  }
}

export async function GET(req: Request): Promise<Response> {
  const date = new URL(req.url).searchParams.get("date") ?? "";
  if (!DATE.test(date)) return json({ error: "bad date" }, 400, "no-store");
  const open = date <= latestDateOnEarth();
  if (!open && process.env.VERCEL_ENV !== "preview" && !(await isAdmin(req))) return json({ error: "not yet" }, 404, "no-store");
  let body: string;
  try {
    body = await readFile(join(process.cwd(), "packs", `${date}.json`), "utf8");
  } catch {
    return json({ error: "no pack" }, 404, open ? "public, max-age=300" : "no-store");
  }
  // started nights can be cached by browsers and Vercel's edge; early ones are private to the admin
  return json(body, 200, open ? "public, max-age=300, s-maxage=3600" : "private, no-store");
}
