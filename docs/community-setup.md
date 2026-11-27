# Community skies: setup

Community skies are player-made skies on the Star Atlas. They use the same Supabase project as accounts
(see [accounts-setup.md](accounts-setup.md)), so do that first.

Until launch they stay behind a "coming soon" veil on playstargazer.io: only preview deployments and localhost show the
working version. To lift the veil, change `communityOpen` in `src/community.ts` to `communityOn`.

## 1. Run the SQL (once, about 1 minute)

1. Supabase dashboard → your project → **SQL Editor** → **New query**.
2. Paste all of [community-setup.sql](community-setup.sql) and click **Run**. It's safe to run again after changes.

This makes the tables, the rules (sign-in to make, review before anyone sees a sky, 1 sky each while fewer than 100
exist, spacing and the home zone, reports hiding a sky after 3) and a public Storage bucket called `community` for the
pictures (400 KB each, PNG or WebP only).

## 2. Make yourself an admin

Admins see the **REVIEW** button on the Community skies page and approve or reject new skies. In the SQL Editor, run
(with the email you sign in with, in lower case):

```sql
insert into public.community_admins (email) values ('you@example.com');
```

## 3. Give a player more skies (later, for the supporter pass)

```sql
insert into public.community_allowance (user_id, extra, note)
values ('<the player''s user id from Authentication → Users>', 2, 'supporter')
on conflict (user_id) do update set extra = excluded.extra, note = excluded.note;
```

## 4. Review

Open the game (a preview deployment until launch) → Star Atlas → any **COMMUNITY SKIES** zone → **BROWSE** →
**REVIEW (n)**. Each waiting sky shows its pictures, answers, difficulty and notes.

- **APPROVE** puts it on the map for everyone.
- **REJECT** sends it back with your note (the maker sees it under Your skies) and deletes its pictures.
- A sky hidden after 3 reports shows up here too, with the reasons. Approving it again resets its report count.

There is no email alert for new skies yet; check the queue now and then.

## 5. Try it without a database

On localhost, add `?mockcommunity` to the URL (`http://localhost:5173/?mockcommunity`). Everything is stored in the
browser, you are always signed in and an admin, and you can make up to 3 skies.

## Takedown requests

The community rules page (`/terms`) points people to "Report this sky" and to hello@playstargazer.io. To remove a sky
by hand: Supabase → Table Editor → `community_skies` → delete the row (its objects go with it), then Storage →
`community` → delete the folder with the sky's id.
