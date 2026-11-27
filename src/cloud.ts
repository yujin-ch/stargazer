/**
 * Optional accounts (Supabase): sign in with Google or an emailed link, and your nights and universe follow you to
 * any device. Off unless VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set at build time. The Supabase code is only
 * downloaded when someone opens the account panel or already has a session, so players who never sign in don't pay for it.
 *
 * One row per player in `progress` (user_id, data jsonb), guarded by row-level security so each player can only read
 * and write their own row (see docs/accounts-setup.md).
 */
import type { SupabaseClient, Session } from "@supabase/supabase-js";
import { store, mergeSaved, type Saved } from "./storage";

const URL_ = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const accountsOn = !!(URL_ && KEY);

let client: SupabaseClient | null = null;
let session: Session | null = null;
let pushTimer = 0;
let pulling = false;
const watchers: (() => void)[] = [];

/** Did this browser sign in before? (Supabase keeps its session under an sb-…-auth-token key.) */
export function hadSession(): boolean {
  try { return Object.keys(localStorage).some((k) => k.startsWith("sb-") && k.endsWith("-auth-token")); } catch { return false; }
}

async function getClient(): Promise<SupabaseClient | null> {
  if (!accountsOn) return null;
  if (client) return client;
  const { createClient } = await import("@supabase/supabase-js");
  client = createClient(URL_!, KEY!, { auth: { flowType: "pkce", persistSession: true, detectSessionInUrl: true } });
  client.auth.onAuthStateChange((event, s) => {
    session = s;
    if (event === "SIGNED_IN" || (event === "INITIAL_SESSION" && s)) void pull();
    for (const w of watchers) w();
  });
  const { data } = await client.auth.getSession();
  session = data.session;
  return client;
}

/** Start syncing if this browser has signed in before (called once at boot). */
export async function initCloud(onSynced: () => void) {
  if (!accountsOn) return;
  syncedHook = onSynced;
  store.onChange(() => schedulePush());
  // coming back from Google or an emailed link: the URL carries a code to exchange
  const back = /[?&]code=/.test(location.search) || location.hash.includes("access_token");
  if (hadSession() || back) await getClient();
  if (back) history.replaceState(null, "", location.pathname);
}
let syncedHook: () => void = () => undefined;

export function onAccountChange(f: () => void) { watchers.push(f); }
export function signedInEmail(): string | null { return session?.user?.email ?? null; }
/** The access token, for asking the server for nights early (admins only). */
export async function accessToken(): Promise<string | null> {
  if (!accountsOn || !hadSession()) return null;
  await getClient();
  return session?.access_token ?? null;
}

/** Bring the account's save down and merge it with this browser's, then save the merge both ways. */
async function pull() {
  const c = await getClient();
  if (!c || !session || pulling) return;
  pulling = true;
  try {
    const { data, error } = await c.from("progress").select("data").eq("user_id", session.user.id).maybeSingle();
    if (error) throw error;
    const before = JSON.stringify(store.raw());
    const merged = mergeSaved(store.raw(), (data?.data ?? {}) as Partial<Saved>);
    store.replace(merged);
    await push();
    if (JSON.stringify(merged) !== before) syncedHook();
  } catch (e) {
    console.warn("[stargazer] sync failed", e);
  } finally {
    pulling = false;
  }
}

function schedulePush() {
  if (!session) return;
  clearTimeout(pushTimer);
  pushTimer = window.setTimeout(() => void push(), 1500);
}

async function push() {
  const c = await getClient();
  if (!c || !session) return;
  const { error } = await c.from("progress").upsert({ user_id: session.user.id, data: store.raw(), updated_at: new Date().toISOString() });
  if (error) console.warn("[stargazer] save failed", error.message);
}

export async function signInWithGoogle() {
  const c = await getClient();
  await c?.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + "/" } });
}

/** Email a sign-in link. Returns an error message, or "" when sent. */
export async function signInWithEmail(email: string): Promise<string> {
  const c = await getClient();
  if (!c) return "Accounts aren't switched on yet.";
  const { error } = await c.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + "/" } });
  return error ? error.message : "";
}

export async function signOut() {
  const c = await getClient();
  await push();
  await c?.auth.signOut();
  session = null;
  for (const w of watchers) w();
}

/** Delete the saved copy in the account (this browser keeps its own), then sign out. */
export async function deleteCloudSave(): Promise<string> {
  const c = await getClient();
  if (!c || !session) return "Not signed in.";
  const { error } = await c.from("progress").delete().eq("user_id", session.user.id);
  if (error) return error.message;
  await c.auth.signOut();
  session = null;
  for (const w of watchers) w();
  return "";
}

/** The Supabase client (loads it on first use), or null when accounts are off. For community skies. */
export async function cloudClient(): Promise<SupabaseClient | null> { return getClient(); }
/** The signed-in player's id, or null. */
export function signedInId(): string | null { return session?.user?.id ?? null; }

/** Make sure the client is loaded (when the account panel opens), so the panel can show who's signed in. */
export async function warmUp() { await getClient(); }
