/**
 * Real crowd scores: one tally per night and streak tier, kept in Upstash Redis (connected through Vercel Storage,
 * which sets KV_REST_API_URL / KV_REST_API_TOKEN, or UPSTASH_REDIS_REST_URL / _TOKEN).
 *
 *   GET  /api/scores?night=14&tier=0          -> { count, scores: { "<score>": <players> } }
 *   POST /api/scores { night, tier, score, id } -> same, after counting this player once
 *
 * Scores are anonymous: `id` is a random id the browser keeps, only used so one device counts once a night.
 *
 * Abuse limits (all keyed on a salted hash of the caller's IP, never the IP itself, and expiring on their own):
 * at most READS_PER_MIN reads and WRITES_PER_MIN writes a minute, and at most NEW_PER_IP new players counted
 * from one address a night, so a script minting fresh ids can't flood the hill.
 */
declare const process: { env: Record<string, string | undefined> };

const LAUNCH = Date.UTC(2026, 10, 12); // keep in step with CONFIG.launchDate (puzzle #1)
const MAX_SCORE = 5000;
const KEEP_SECONDS = 60 * 60 * 24 * 120;
const READS_PER_MIN = 60, WRITES_PER_MIN = 10, NEW_PER_IP = 8;
const MAX_BODY = 512;

type Cmd = (string | number)[];

export async function redis(cmds: Cmd[]): Promise<unknown[]> {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error("no redis configured");
  const r = await fetch(`${url}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmds.map((c) => c.map(String))),
  });
  if (!r.ok) throw new Error(`redis ${r.status}`);
  return ((await r.json()) as { result?: unknown; error?: string }[]).map((x) => {
    if (x.error) throw new Error(x.error);
    return x.result;
  });
}

/** Tonight's puzzle number somewhere on Earth: players' local dates span about a day either side of UTC. */
export function nightsOpenNow(now = Date.now()): [number, number] {
  const n = Math.floor((now - LAUNCH) / 86400000) + 1;
  return [n - 1, n + 1];
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

/** A short salted hash of the caller's address (Vercel sets x-real-ip / x-forwarded-for itself). */
async function who(req: Request): Promise<string> {
  const ip = req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const salt = process.env.IP_HASH_SALT ?? "stargazer-night-sky";
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${ip}`)));
  return Array.from(d.slice(0, 12), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Count one request in this minute's bucket; true if the caller is over the limit. */
async function limited(kind: "r" | "w", h: string, max: number): Promise<boolean> {
  const key = `rl:${kind}:${h}:${Math.floor(Date.now() / 60000)}`;
  const [n] = (await redis([["INCR", key], ["EXPIRE", key, 90]])) as [number, number];
  return Number(n) > max;
}

const int = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN);

async function tally(night: number, tier: number) {
  const [flat] = (await redis([["HGETALL", `crowd2:${night}:${tier}`]])) as [string[] | null];
  const scores: Record<string, number> = {};
  let count = 0;
  for (let i = 0; flat && i < flat.length; i += 2) {
    const c = Number(flat[i + 1]);
    scores[flat[i]] = c;
    count += c;
  }
  return { count, scores };
}

export async function GET(req: Request): Promise<Response> {
  const q = new URL(req.url).searchParams;
  const night = int(q.get("night")), tier = int(q.get("tier") ?? "0");
  if (!Number.isInteger(night) || night < 1 || night > nightsOpenNow()[1] || !Number.isInteger(tier) || tier < 0 || tier > 9) return json({ error: "bad request" }, 400);
  try {
    if (await limited("r", await who(req), READS_PER_MIN)) return json({ error: "slow down" }, 429);
    return json(await tally(night, tier));
  } catch {
    return json({ error: "unavailable" }, 503);
  }
}

export async function POST(req: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY) return json({ error: "too large" }, 413);
    body = JSON.parse(text) as Record<string, unknown>;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("not an object");
  } catch {
    return json({ error: "bad request" }, 400);
  }
  const night = int(body.night), tier = int(body.tier), score = int(body.score);
  const id = typeof body.id === "string" ? body.id : "";
  const [lo, hi] = nightsOpenNow();
  if (!Number.isInteger(night) || night < lo || night > hi) return json({ error: "night is not open" }, 400);
  if (!Number.isInteger(tier) || tier < 0 || tier > 9) return json({ error: "bad tier" }, 400);
  if (!Number.isInteger(score) || score < 0 || score > MAX_SCORE) return json({ error: "bad score" }, 400);
  if (!/^[a-z0-9-]{8,64}$/i.test(id)) return json({ error: "bad id" }, 400);
  try {
    const h = await who(req);
    if (await limited("w", h, WRITES_PER_MIN)) return json({ error: "slow down" }, 429);
    const [fresh] = await redis([["SET", `seen2:${night}:${id}`, 1, "NX", "EX", KEEP_SECONDS]]);
    // one address can only add so many new players a night (a family or a classroom is fine; a script isn't)
    let allowed = false;
    if (fresh === "OK") {
      const ipKey = `ipn:${night}:${h}`;
      const [n] = (await redis([["INCR", ipKey], ["EXPIRE", ipKey, 60 * 60 * 48]])) as [number, number];
      allowed = Number(n) <= NEW_PER_IP;
    }
    if (allowed) {
      const key = `crowd2:${night}:${tier}`; // "2": the points scale changed on 2026-11-26
      await redis([["HINCRBY", key, score, 1], ["EXPIRE", key, KEEP_SECONDS]]);
    }
    return json(await tally(night, tier));
  } catch {
    return json({ error: "unavailable" }, 503);
  }
}
