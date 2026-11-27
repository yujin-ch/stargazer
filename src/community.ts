/**
 * Community skies: skies made by players, placed on the Star Atlas, played by anyone.
 *
 * Stored in Supabase (docs/community-setup.sql): a row per sky, a row per object, and two pictures per object in the
 * public "community" bucket (<sky id>/<n>.png, the 8-stage plate strip, and <sky id>/<n>.hi.webp, the sharp photo).
 * A new sky waits as "pending" until an admin approves it. On localhost, ?mockcommunity swaps in an in-browser stand-in
 * (localStorage) so the screens can be tried without a database.
 */
import { CONFIG } from "./config";
import { accountsOn, cloudClient, signedInId, signedInEmail } from "./cloud";

export type SkyStatus = "pending" | "live" | "rejected" | "hidden";
export interface CommunitySky {
  id: string;
  title: string;
  blurb: string;
  maker: string;
  seconds: number;
  n: number;
  x: number;
  y: number;
  status: SkyStatus;
  plays: number;
  reports: number;
  review_note?: string | null;
  created_at: string;
  mine?: boolean;
}
export interface CommunityObject {
  idx: number;
  band: number;
  names: string[];
  note: string;
  strip: string;
  hi: string;
}
export interface NewObject {
  band: number;
  names: string[];
  note: string;
  strip: Blob;
  hi: Blob;
}
export interface NewSky {
  title: string;
  blurb: string;
  maker: string;
  seconds: number;
  x: number;
  y: number;
  feature_ok: boolean;
  objects: NewObject[];
}

const LOCAL = typeof location !== "undefined" && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
const MOCK = LOCAL && typeof location !== "undefined" && new URLSearchParams(location.search).has("mockcommunity");
const COLS = "id,title,blurb,maker,seconds,n,x,y,status,plays,reports,review_note,created_at,owner";

declare const __PREVIEW__: boolean;
/** Whether community skies can work at all here (accounts switched on, or the local stand-in). */
export const communityOn = MOCK || accountsOn;
/** Open to players? Behind a "coming soon" veil on the public site until launch (yujin, 11-27): only preview
 *  deployments and localhost show the working version. */
export const communityOpen = communityOn && (LOCAL || __PREVIEW__);

/** Is (x, y) a spot a new sky may take? Returns why not, or "". */
export function spotProblem(x: number, y: number, others: { x: number; y: number }[]): string {
  const c = CONFIG.community;
  if (Math.abs(x) > 5000 || Math.abs(y) > 5000) return "That's past the edge of the charted sky.";
  if (Math.hypot(x, y) < c.homeRadius) return "The home zone around tonight's sky is kept for the game's own skies.";
  if (others.some((o) => Math.hypot(o.x - x, o.y - y) < c.spacing)) return "Another sky already sits there. Pick a spot a little further away.";
  return "";
}

function friendly(msg: string): string {
  if (/limit/.test(msg)) return "You've made as many skies as you can for now.";
  if (/taken/.test(msg)) return "Someone just took that spot. Pick another one.";
  if (/outside_home/.test(msg)) return "The home zone around tonight's sky is kept for the game's own skies.";
  if (/JWT|auth|permission/i.test(msg)) return "Please sign in again.";
  return msg;
}

// ---------------------------------------------------------------- Supabase

async function db() {
  const c = await cloudClient();
  if (!c) throw new Error("Accounts aren't switched on.");
  return c;
}
async function publicUrl(path: string) {
  return (await db()).storage.from("community").getPublicUrl(path).data.publicUrl;
}

const supa = {
  async live(): Promise<CommunitySky[]> {
    const { data, error } = await (await db()).from("community_skies").select(COLS).eq("status", "live").order("created_at", { ascending: false }).limit(1000);
    if (error) throw new Error(error.message);
    const me = signedInId();
    return (data ?? []).map((r) => ({ ...(r as unknown as CommunitySky), mine: (r as { owner: string }).owner === me }));
  },
  async mine(): Promise<CommunitySky[]> {
    const me = signedInId();
    if (!me) return [];
    const { data, error } = await (await db()).from("community_skies").select(COLS).eq("owner", me).order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({ ...(r as unknown as CommunitySky), mine: true }));
  },
  async left(): Promise<number> {
    const { data, error } = await (await db()).rpc("community_left");
    if (error) throw new Error(error.message);
    return Number(data) || 0;
  },
  async isAdmin(): Promise<boolean> {
    if (!signedInEmail()) return false;
    const { data } = await (await db()).rpc("community_is_admin");
    return data === true;
  },
  async objects(sky: string): Promise<CommunityObject[]> {
    const { data, error } = await (await db()).from("community_objects").select("idx,band,names,note").eq("sky_id", sky).order("idx");
    if (error) throw new Error(error.message);
    return Promise.all((data ?? []).map(async (o) => ({ ...(o as Omit<CommunityObject, "strip" | "hi">),
      strip: await publicUrl(`${sky}/${o.idx}.png`), hi: await publicUrl(`${sky}/${o.idx}.hi.webp`) })));
  },
  async create(s: NewSky, progress: (done: number, of: number) => void): Promise<string> {
    const c = await db();
    const { objects, ...meta } = s;
    const { data, error } = await c.from("community_skies").insert({ ...meta, n: objects.length }).select("id").single();
    if (error) throw new Error(friendly(error.message));
    const id = (data as { id: string }).id;
    try {
      let done = 0;
      const of = objects.length * 2;
      for (const [i, o] of objects.entries()) {
        for (const [name, blob, type] of [[`${i}.png`, o.strip, "image/png"], [`${i}.hi.webp`, o.hi, "image/webp"]] as const) {
          const up = await c.storage.from("community").upload(`${id}/${name}`, blob, { contentType: type, upsert: false });
          if (up.error) throw new Error(up.error.message);
          progress(++done, of);
        }
      }
      const rows = objects.map((o, i) => ({ sky_id: id, idx: i, band: o.band, names: o.names, note: o.note }));
      const ins = await c.from("community_objects").insert(rows);
      if (ins.error) throw new Error(ins.error.message);
      return id;
    } catch (e) {
      await supa.remove(id).catch(() => undefined);
      throw e;
    }
  },
  async remove(id: string): Promise<void> {
    const c = await db();
    const { data } = await c.storage.from("community").list(id, { limit: 200 });
    if (data?.length) await c.storage.from("community").remove(data.map((f) => `${id}/${f.name}`));
    const { error } = await c.from("community_skies").delete().eq("id", id);
    if (error) throw new Error(error.message);
  },
  async report(id: string, reason: string): Promise<void> {
    const { error } = await (await db()).from("community_reports").insert({ sky_id: id, reason });
    if (error) throw new Error(error.message);
  },
  async played(id: string): Promise<number> {
    const { data } = await (await db()).rpc("community_play", { sky: id });
    return Number(data) || 0;
  },
  async queue(): Promise<CommunitySky[]> {
    const { data, error } = await (await db()).from("community_skies").select(COLS).in("status", ["pending", "hidden"]).order("created_at");
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as CommunitySky[];
  },
  async reports(id: string): Promise<string[]> {
    const { data } = await (await db()).from("community_reports").select("reason").eq("sky_id", id).order("created_at");
    return (data ?? []).map((r) => (r as { reason: string }).reason);
  },
  async review(id: string, status: SkyStatus, note: string): Promise<void> {
    const c = await db();
    const { error } = await c.from("community_skies").update({ status, review_note: note || null }).eq("id", id);
    if (error) throw new Error(error.message);
    if (status === "live") await c.from("community_reports").delete().eq("sky_id", id);
    if (status === "rejected") {
      // a rejected sky's pictures go; its row stays so the maker sees why
      const { data } = await c.storage.from("community").list(id, { limit: 200 });
      if (data?.length) await c.storage.from("community").remove(data.map((f) => `${id}/${f.name}`));
    }
  },
};

// ---------------------------------------------------------------- local stand-in (?mockcommunity on localhost)

interface MockDb { skies: (CommunitySky & { owner: string })[]; objects: Record<string, CommunityObject[]>; reports: Record<string, string[]> }
const MOCK_KEY = "stargazer:mock-community";
function mockDb(): MockDb {
  try { const d = JSON.parse(localStorage.getItem(MOCK_KEY) ?? ""); if (d?.skies) return d; } catch { /* fresh */ }
  return { skies: [], objects: {}, reports: {} };
}
function mockSave(d: MockDb) { localStorage.setItem(MOCK_KEY, JSON.stringify(d)); }
const asDataUrl = (b: Blob) => new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(b); });
const MOCK_ME = "mock-user";

const mock: typeof supa = {
  async live() { return mockDb().skies.filter((s) => s.status === "live").map((s) => ({ ...s, mine: s.owner === MOCK_ME })); },
  async mine() { return mockDb().skies.filter((s) => s.owner === MOCK_ME).map((s) => ({ ...s, mine: true })); },
  async left() {
    const d = mockDb(), c = CONFIG.community;
    const base = d.skies.filter((s) => s.status !== "rejected").length < c.freeUntil ? c.freeSkies : 0;
    return Math.max(0, base + 2 - d.skies.filter((s) => s.owner === MOCK_ME && s.status !== "rejected").length);
  },
  async isAdmin() { return true; },
  async objects(sky) { return mockDb().objects[sky] ?? []; },
  async create(s, progress) {
    const d = mockDb();
    const why = spotProblem(s.x, s.y, d.skies.filter((k) => k.status !== "rejected"));
    if (why) throw new Error(why);
    const id = `mock-${Date.now().toString(36)}`;
    const objs: CommunityObject[] = [];
    for (const [i, o] of s.objects.entries()) {
      objs.push({ idx: i, band: o.band, names: o.names, note: o.note, strip: await asDataUrl(o.strip), hi: await asDataUrl(o.hi) });
      progress(i + 1, s.objects.length);
    }
    d.skies.push({ id, title: s.title, blurb: s.blurb, maker: s.maker, seconds: s.seconds, n: s.objects.length, x: s.x, y: s.y, status: "pending", plays: 0, reports: 0, created_at: new Date().toISOString(), owner: MOCK_ME });
    d.objects[id] = objs;
    mockSave(d);
    return id;
  },
  async remove(id) { const d = mockDb(); d.skies = d.skies.filter((s) => s.id !== id); delete d.objects[id]; mockSave(d); },
  async report(id, reason) {
    const d = mockDb(), s = d.skies.find((k) => k.id === id);
    if (!s) return;
    (d.reports[id] ??= []).push(reason);
    s.reports++;
    if (s.status === "live" && s.reports >= CONFIG.community.hideAfterReports) s.status = "hidden";
    mockSave(d);
  },
  async played(id) { const d = mockDb(), s = d.skies.find((k) => k.id === id); if (!s) return 0; s.plays++; mockSave(d); return s.plays; },
  async queue() { return mockDb().skies.filter((s) => s.status === "pending" || s.status === "hidden"); },
  async reports(id) { return mockDb().reports[id] ?? []; },
  async review(id, status, note) {
    const d = mockDb(), s = d.skies.find((k) => k.id === id);
    if (!s) return;
    s.status = status; s.review_note = note || null;
    if (status === "live") { delete d.reports[id]; s.reports = 0; }
    mockSave(d);
  },
};

export const community = MOCK ? mock : supa;
/** Signed in (or the local stand-in, which always is). */
export function canMake(): boolean { return MOCK || !!signedInId(); }
export const mockCommunity = MOCK;
