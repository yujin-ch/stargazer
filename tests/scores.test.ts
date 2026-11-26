import { describe, it, expect, beforeEach, vi } from "vitest";
import { GET, POST, nightsOpenNow } from "../api/scores";

// a tiny in-memory stand-in for Upstash's REST pipeline
let db: Map<string, string | Map<string, string>>;
function fakeRedis(cmd: string[]): unknown {
  const [op, key, ...a] = cmd;
  if (op === "SET") { if (a.includes("NX") && db.has(key)) return null; db.set(key, a[0]); return "OK"; }
  if (op === "HINCRBY") { const h = (db.get(key) as Map<string, string>) ?? new Map(); h.set(a[0], String(Number(h.get(a[0]) ?? 0) + Number(a[1]))); db.set(key, h); return Number(h.get(a[0])); }
  if (op === "EXPIRE") return 1;
  if (op === "INCR") { const v = Number(db.get(key) ?? 0) + 1; db.set(key, String(v)); return v; }
  if (op === "HGETALL") { const h = db.get(key) as Map<string, string> | undefined; return h ? [...h].flat() : []; }
  throw new Error(op);
}

beforeEach(() => {
  db = new Map();
  (globalThis as any).process = { env: { KV_REST_API_URL: "https://redis.test", KV_REST_API_TOKEN: "t" } };
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) =>
    new Response(JSON.stringify((JSON.parse(String(init.body)) as string[][]).map((c) => ({ result: fakeRedis(c) })))));
});

const night = nightsOpenNow()[0] + 1;
const post = (body: object, ip = "1.2.3.4") => POST(new Request("https://x/api/scores", { method: "POST", body: JSON.stringify(body), headers: { "x-real-ip": ip } }));

describe("crowd scores api", () => {
  it("counts each device once a night and returns the tally", async () => {
    await post({ night, tier: 0, score: 31, id: "device-aaaa" });
    await post({ night, tier: 0, score: 31, id: "device-aaaa" });
    await post({ night, tier: 0, score: 18, id: "device-bbbb" });
    const r = await (await GET(new Request(`https://x/api/scores?night=${night}&tier=0`))).json();
    expect(r).toEqual({ count: 2, scores: { "31": 1, "18": 1 } });
  });
  it("rejects closed nights, silly scores and bad ids", async () => {
    expect((await post({ night: night + 5, tier: 0, score: 10, id: "device-aaaa" })).status).toBe(400);
    expect((await post({ night, tier: 0, score: 9999, id: "device-aaaa" })).status).toBe(400);
    expect((await post({ night, tier: 0, score: 10, id: "x" })).status).toBe(400);
  });
  it("caps new players from one address a night, and rate-limits bursts", async () => {
    for (let i = 0; i < 9; i++) await post({ night, tier: 1, score: 500, id: `bot-${i}-aaaaaa` }, "6.6.6.6");
    let r = await (await GET(new Request(`https://x/api/scores?night=${night}&tier=1`))).json();
    expect(r.count).toBe(8);
    const codes = [];
    for (let i = 0; i < 12; i++) codes.push((await post({ night, tier: 1, score: 5, id: `spam-${i}-bbbbbb` }, "7.7.7.7")).status);
    expect(codes.filter((c) => c === 429).length).toBe(2);
    r = await (await GET(new Request(`https://x/api/scores?night=${night}&tier=1`))).json();
    expect(r.count).toBe(16);
  });
  it("rejects oversized bodies and nights that haven't happened", async () => {
    expect((await POST(new Request("https://x/api/scores", { method: "POST", body: "x".repeat(2000) }))).status).toBe(413);
    expect((await GET(new Request(`https://x/api/scores?night=999999&tier=0`))).status).toBe(400);
  });
  it("says unavailable when redis isn't set up", async () => {
    (globalThis as any).process = { env: {} };
    expect((await GET(new Request(`https://x/api/scores?night=${night}&tier=0`))).status).toBe(503);
  });
});
