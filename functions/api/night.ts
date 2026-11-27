/**
 * Cloudflare Pages version of api/night.ts:  GET /api/night?date=YYYY-MM-DD
 *
 * Same rule as on Vercel: a night is handed out once it has started somewhere on Earth (UTC+14); before that only to
 * a signed-in admin (Supabase token whose confirmed email is in ADMIN_EMAILS). Unlike Vercel, Cloudflare preview
 * addresses are public, so previews get no early access here.
 * Packs are bundled in at build time by scripts/cf/gen-packs.mjs (Pages Functions can't read the packs/ folder).
 */
import PACKS from "../../cf/packs.gen.js";

interface Env { ADMIN_EMAILS?: string; SUPABASE_URL?: string; SUPABASE_ANON_KEY?: string; VITE_SUPABASE_URL?: string; VITE_SUPABASE_ANON_KEY?: string }

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const packs: Record<string, string> = PACKS;

/** The latest calendar date anywhere on Earth right now (UTC+14). */
export function latestDateOnEarth(now = Date.now()): string {
  return new Date(now + 14 * 3600 * 1000).toISOString().slice(0, 10);
}

const json = (body: string, status: number, cache: string) =>
  new Response(body, { status, headers: { "Content-Type": "application/json", "Cache-Control": cache } });

async function isAdmin(req: Request, env: Env): Promise<boolean> {
  const admins = (env.ADMIN_EMAILS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const url = env.SUPABASE_URL ?? env.VITE_SUPABASE_URL, key = env.SUPABASE_ANON_KEY ?? env.VITE_SUPABASE_ANON_KEY;
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

export async function onRequestGet({ request, env }: { request: Request; env: Env }): Promise<Response> {
  const date = new URL(request.url).searchParams.get("date") ?? "";
  if (!DATE.test(date)) return json('{"error":"bad date"}', 400, "no-store");
  const open = date <= latestDateOnEarth();
  if (!open && !(await isAdmin(request, env))) return json('{"error":"not yet"}', 404, "no-store");
  const body = packs[date];
  if (!body) return json('{"error":"no pack"}', 404, open ? "public, max-age=300" : "no-store");
  return json(body, 200, open ? "public, max-age=300, s-maxage=3600" : "private, no-store");
}
