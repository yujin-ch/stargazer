/**
 * Real crowd scores: one tally per night and streak tier, kept in Upstash Redis (connected through Vercel Storage,
 * which sets KV_REST_API_URL / KV_REST_API_TOKEN, or UPSTASH_REDIS_REST_URL / _TOKEN).
 *
 *   GET  /api/scores?night=14&tier=0          -> { count, scores: { "<score>": <players> } }
 *   POST /api/scores { night, tier, score, id } -> same, after counting this player once
 *
 * Scores are anonymous: `id` is a random id the browser keeps, only used so one device counts once a night.
 */
declare const process: { env: Record<string, string | undefined> };

const LAUNCH = Date.UTC(2026, 10, 12); // keep in step with CONFIG.launchDate (puzzle #1)
const MAX_SCORE = 400;
const KEEP_SECONDS = 60 * 60 * 24 * 120;

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

const int = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN);

async function tally(night: number, tier: number) {
  const [flat] = (await redis([["HGETALL", `crowd:${night}:${tier}`]])) as [string[] | null];
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
  if (!Number.isInteger(night) || !Number.isInteger(tier) || tier < 0 || tier > 9) return json({ error: "bad request" }, 400);
  try {
    return json(await tally(night, tier));
  } catch {
    return json({ error: "unavailable" }, 503);
  }
}

export async function POST(req: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
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
    const [fresh] = await redis([["SET", `seen:${night}:${id}`, 1, "NX", "EX", KEEP_SECONDS]]);
    if (fresh === "OK") {
      const key = `crowd:${night}:${tier}`;
      await redis([["HINCRBY", key, score, 1], ["EXPIRE", key, KEEP_SECONDS]]);
    }
    return json(await tally(night, tier));
  } catch {
    return json({ error: "unavailable" }, 503);
  }
}
