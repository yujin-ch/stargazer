# Accounts setup (Supabase)

Accounts are optional for players. They keep a player's nights, universe and settings across devices, and they give
admins early access to future nights. The game works without any of this: if the two `VITE_SUPABASE_*` variables
aren't set, the account panel just doesn't appear.

## 1. Create the project (free tier)

1. Go to supabase.com → New project. Name it `stargazer`, pick a region near most players, and save the database password in your password manager.
2. When it's ready, open **Project Settings → API**. You'll need the **Project URL** and the **anon public** key (step 4). The anon key is meant to be public (it's in every player's browser); row-level security below is what protects the data. Never use the `service_role` key in the game.

## 2. Create the table

Open **SQL Editor → New query**, paste this, and run it:

```sql
create table public.progress (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.progress enable row level security;

create policy "read own progress"   on public.progress for select using (auth.uid() = user_id);
create policy "insert own progress" on public.progress for insert with check (auth.uid() = user_id);
create policy "update own progress" on public.progress for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "delete own progress" on public.progress for delete using (auth.uid() = user_id);
```

## 3. Sign-in methods

**Authentication → URL Configuration**
- Site URL: `https://playstargazer.io`
- Redirect URLs: add `https://playstargazer.io/**`, `https://www.playstargazer.io/**` and `https://stargazer-*.vercel.app/**` (your preview deployments; check it matches a preview URL in Vercel).

**Authentication → Providers → Email**: on by default. Magic links work as is. Optional: under **Emails → SMTP**, use your own sender later (Supabase's built-in sender is rate-limited to a few emails an hour).

**Authentication → Providers → Google**:
1. In Google Cloud Console (console.cloud.google.com) create a project → **APIs & Services → OAuth consent screen**: External, app name Stargazer, support email, add the domain `playstargazer.io`, scopes: email and profile only. Publish it.
2. **Credentials → Create credentials → OAuth client ID** → Web application. Authorized redirect URI: the callback URL Supabase shows on its Google provider page (`https://<project>.supabase.co/auth/v1/callback`).
3. Paste the Client ID and Client secret into Supabase's Google provider page and enable it.

## 4. Vercel environment variables

Vercel → stargazer → **Settings → Environment Variables** (Production and Preview):

| Name | Value |
|---|---|
| `VITE_SUPABASE_URL` | Project URL from step 1 |
| `VITE_SUPABASE_ANON_KEY` | anon public key from step 1 |
| `ADMIN_EMAILS` | your email (comma-separate more admins); these accounts can open future nights early |

Then redeploy (Deployments → … → Redeploy). Settings in the game now shows **Your account**.

## 5. Early access as an admin

Sign in on playstargazer.io with an admin email, then open `https://playstargazer.io/?date=2026-11-29` (any planned date).
The server checks your sign-in with Supabase before it hands out a future night; everyone else gets nothing until that
night has started somewhere on Earth.

## Keep the repository private

Future nights live in `packs/<date>.json` (outside the public site) and their pictures have random file names. If the
GitHub repository is public, anyone can still read `packs/` there, so make it private: GitHub → the repo → Settings →
General → Danger Zone → Change visibility → Private. Vercel keeps deploying from a private repo.
