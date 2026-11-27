# Moving Stargazer to Cloudflare Pages

Cloudflare Pages serves the static site with no request or bandwidth bill on the free plan. `api/night` runs as a
Pages Function (`functions/api/night.ts`); the Vercel setup keeps working untouched until the domain moves.

## 1. Create the project (test address first)
1. dash.cloudflare.com (free account) → **Workers & Pages → Create → Pages → Connect to Git** → `yujin-ch/stargazer`.
2. Production branch: `main`. Framework preset: **None**. Build command: `npm run build:cf`. Output directory: `dist`.
3. **Environment variables (Production)**, copied from Vercel → Settings → Environment Variables:
   `NODE_VERSION=22`, `VITE_SITE_URL=https://playstargazer.io`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
   `VITE_TIP_URL` (if set), `ADMIN_EMAILS`.
4. Deploy. The site appears at `https://<project>.pages.dev`. Play tonight's sky there end to end.
5. Supabase → Authentication → URL Configuration → Redirect URLs: add `https://<project>.pages.dev/**` to test sign-in.
6. Pages project → **Metrics → Web Analytics → Enable** (replaces Vercel Analytics; the build drops Vercel's tag on Cloudflare).

## 2. Switch the domain (only after step 1 checks out)
1. Pages project → **Custom domains → Set up a domain** → `playstargazer.io` (and `www`). Cloudflare offers to add the
   zone and gives two nameservers.
2. Before changing nameservers, check Cloudflare imported every DNS record from Spaceship, especially **email
   forwarding (MX/TXT)** for hello@playstargazer.io. If forwarding was Spaceship's own service, set up Cloudflare
   **Email Routing** (free) instead.
3. Spaceship → domain → Nameservers → custom → the two Cloudflare nameservers. Takes minutes to a few hours.
4. Once playstargazer.io serves from Cloudflare (and `/ads.txt` loads), remove the domain from Vercel and
   disconnect Vercel's Git integration so it stops building.

## Notes
- Cloudflare preview addresses (other branches) are public; future nights stay private there (admin token only).
- `public/_headers` mirrors `vercel.json`'s headers. Change both while both hosts exist.
- Packs are bundled into the function at build time (`scripts/cf/gen-packs.mjs`), so a new pack still just needs a push to `main`.
