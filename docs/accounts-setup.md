# Accounts setup (Supabase)

Accounts are optional for players. They keep a player's nights, universe and settings across devices, and they give
admins early access to future nights. The game works without any of this: if the two `VITE_SUPABASE_*` variables
aren't set, the account panel just doesn't appear.

## 1. Create the project (free tier)

1. supabase.com → **New project**. Name it `stargazer`, pick a region near most players, and save the database password in your password manager.
2. If the form shows **Security** options, leave **Enable Data API** ON (the game talks to its table through it). Turning on automatic row-level security is fine too; the SQL below turns it on anyway.
3. When the project is ready, click **Connect** at the top of the project page (or go to **Project Settings → API Keys**). Copy two things for step 4:
   - the **Project URL** (`https://<something>.supabase.co`)
   - the **Publishable key** (starts with `sb_publishable_`). If your project only shows the older **anon** key (a long string starting with `eyJ`), that works too.

   The publishable key is meant to be public (it ends up in every player's browser); the row-level security in step 2 is what protects the data. Never put a **secret** key (`sb_secret_…`) or the old `service_role` key into the game.

## 2. Create the table

In the left sidebar open **SQL Editor**, start a new query, paste this, and click **Run**:

```sql
create table public.progress (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.progress enable row level security;

-- signed-in players may reach the table at all (newer projects don't grant this automatically)
grant select, insert, update, delete on public.progress to authenticated;

create policy "read own progress"   on public.progress for select to authenticated using (auth.uid() = user_id);
create policy "insert own progress" on public.progress for insert to authenticated with check (auth.uid() = user_id);
create policy "update own progress" on public.progress for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "delete own progress" on public.progress for delete to authenticated using (auth.uid() = user_id);
```

It should say "Success. No rows returned". Afterwards, **Advisors → Security Advisor** should show no warning about `progress`.

## 3. Sign-in methods

**Authentication → URL Configuration**
- **Site URL**: `https://playstargazer.io`
- **Redirect URLs** → Add URL, one at a time: `https://playstargazer.io/**`, `https://www.playstargazer.io/**` and `https://*.stargazer-5pf.pages.dev/**` (Cloudflare preview addresses).

**Email (magic links)**: under **Authentication → Sign In / Providers**, Email is on by default, so emailed links work as is. Supabase's built-in sender only sends a few emails an hour; later you can plug in your own sender under **Authentication → Emails → SMTP Settings**.

**Google** (Google renamed its screens to "Google Auth Platform"):
1. Supabase: **Authentication → Sign In / Providers → Google**. Leave this tab open; it shows the **Callback URL** you need below (`https://<project>.supabase.co/auth/v1/callback`).
2. Google Cloud Console (console.cloud.google.com): create a project (or pick one), then search for **Google Auth Platform** (searching "OAuth consent screen" also gets you there) and click **Get started**:
   - **Branding**: app name `Stargazer`, your support email, logo optional, and under Authorized domains add `playstargazer.io` and `supabase.co`.
   - **Audience**: External. Click **Publish app** so anyone can sign in (in "Testing" only listed test users can).
   - **Data Access**: the email and profile scopes are there by default; add `openid`. Nothing else.
   - **Clients → Create client** → Application type **Web application**, name `Stargazer web`.
     - Authorized JavaScript origins: `https://playstargazer.io` and `https://www.playstargazer.io`.
     - Authorized redirect URIs: the Supabase **Callback URL** from step 1 (not your site's URL).
     - Click **Create** and copy the **Client ID** and **Client secret**.
3. Back on the Supabase Google page: switch it on, paste the Client ID and Client secret, and **Save**.

If Google says `redirect_uri_mismatch`, the redirect URI in the Google client doesn't exactly match Supabase's Callback URL. If it says the app is in testing, you haven't clicked Publish app under Audience.

## 4. Cloudflare environment variables

Cloudflare → Workers & Pages → stargazer → **Settings → Variables and Secrets** (Production and Preview):

| Name | Value |
|---|---|
| `VITE_SUPABASE_URL` | Project URL from step 1 |
| `VITE_SUPABASE_ANON_KEY` | the Publishable key from step 1 (or the old anon key); the name stays "ANON" on purpose |
| `ADMIN_EMAILS` | your email (comma-separate more admins); these accounts can open future nights early |

Then redeploy (Deployments → … → Retry deployment). Settings in the game now shows **Your account**.

## 5. Early access as an admin

Sign in on playstargazer.io with an admin email, then open `https://playstargazer.io/?date=2026-11-29` (any planned date).
The server checks your sign-in with Supabase before it hands out a future night; everyone else gets nothing until that
night has started somewhere on Earth.

## Keep the repository private

Future nights live in `packs/<date>.json` (outside the public site) and their pictures have random file names. If the
GitHub repository is public, anyone can still read `packs/` there, so make it private: GitHub → the repo → Settings →
General → Danger Zone → Change visibility → Private. Cloudflare Pages keeps deploying from a private repo.
