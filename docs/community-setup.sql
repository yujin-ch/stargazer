-- Community skies: player-made skies on the Star Atlas (see docs/community-setup.md).
-- Run once in Supabase: SQL Editor -> New query -> paste all of this -> Run. Safe to run again.
--
-- Rules it enforces (the game checks them too, but these are the ones that count):
--   * only signed-in players can make a sky; anyone (signed in or not) can read live skies and play them
--   * a new sky waits as 'pending' until an admin approves it; only its maker and admins can see it until then
--   * makers can delete their sky but not edit it; only admins change a sky's status
--   * how many skies a player may make: 1 while fewer than 100 skies exist, 0 after that, plus any extra
--     granted in community_allowance (the supporter pass will raise it there)
--   * spots: inside the charted sky (-5000..5000), outside the home zone (radius 1000 around tonight's sky),
--     and at least 40 apart
--   * 10 to 50 objects; reports hide a sky after 3 until an admin looks at it

create table if not exists public.community_admins (
  email text primary key check (email = lower(email))
);

create table if not exists public.community_allowance (
  user_id uuid primary key references auth.users (id) on delete cascade,
  extra int not null default 0 check (extra between 0 and 100),
  note text
);

create table if not exists public.community_skies (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 3 and 60),
  blurb text not null default '' check (char_length(blurb) <= 280),
  maker text not null check (char_length(maker) between 2 and 30),
  seconds int not null default 60 check (seconds in (60, 90, 120, 180)),
  n int not null check (n between 10 and 50),
  x real not null check (x between -5000 and 5000),
  y real not null check (y between -5000 and 5000),
  feature_ok boolean not null default false,
  status text not null default 'pending' check (status in ('pending', 'live', 'rejected', 'hidden')),
  plays int not null default 0,
  reports int not null default 0,
  review_note text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  constraint outside_home check (x * x + y * y >= 1000.0 * 1000.0)
);
create index if not exists community_skies_status on public.community_skies (status);

create table if not exists public.community_objects (
  sky_id uuid not null references public.community_skies (id) on delete cascade,
  idx int not null check (idx between 0 and 49),
  band int not null check (band between 0 and 4),
  names text[] not null check (array_length(names, 1) between 1 and 12),
  note text not null default '' check (char_length(note) <= 200),
  primary key (sky_id, idx)
);

create table if not exists public.community_reports (
  id bigint generated always as identity primary key,
  sky_id uuid not null references public.community_skies (id) on delete cascade,
  reason text not null check (char_length(reason) between 1 and 300),
  reporter uuid default auth.uid(),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- helpers

create or replace function public.community_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from community_admins where email = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;

-- how many more skies this player may make right now
create or replace function public.community_left() returns int
language sql stable security definer set search_path = public as $$
  select greatest(0,
    (case when (select count(*) from community_skies where status <> 'rejected') < 100 then 1 else 0 end)
    + coalesce((select extra from community_allowance where user_id = auth.uid()), 0)
    - (select count(*) from community_skies where owner = auth.uid() and status <> 'rejected'))::int;
$$;

-- checks on every new sky: the allowance and the spacing (a check constraint can't look at other rows)
create or replace function public.community_sky_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.owner is distinct from auth.uid() then raise exception 'not your sky'; end if;
  new.status := 'pending'; new.plays := 0; new.reports := 0; new.review_note := null; new.reviewed_at := null;
  new.created_at := now();
  perform pg_advisory_xact_lock(4207);  -- one new sky at a time, so two can't take the same spot or the last free slot
  if public.community_left() < 1 then raise exception 'sky limit reached'; end if;
  if exists (select 1 from community_skies s where s.status <> 'rejected'
             and (s.x - new.x) ^ 2 + (s.y - new.y) ^ 2 < 40.0 ^ 2) then
    raise exception 'that spot is taken';
  end if;
  return new;
end $$;
drop trigger if exists community_sky_guard on public.community_skies;
create trigger community_sky_guard before insert on public.community_skies
  for each row execute function public.community_sky_guard();

-- admins change status; nothing else about a sky changes after it is made
create or replace function public.community_sky_update_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- plays and reports are counted by the functions above; status and review notes are the admins' job
  -- (pg_trigger_depth() > 1: the report counter hiding a sky after its third report)
  if (new.status, new.review_note) is distinct from (old.status, old.review_note) and not public.community_is_admin()
     and pg_trigger_depth() <= 1 then
    raise exception 'only admins can change a sky';
  end if;
  if (new.id, new.owner, new.title, new.blurb, new.maker, new.seconds, new.n, new.x, new.y, new.created_at)
     is distinct from (old.id, old.owner, old.title, old.blurb, old.maker, old.seconds, old.n, old.x, old.y, old.created_at)
  then raise exception 'skies cannot be edited'; end if;
  if new.status is distinct from old.status and pg_trigger_depth() <= 1 then
    new.reviewed_at := now();
    if new.status = 'live' then new.reports := 0; end if;  -- approved again after reports: start the count over
  end if;
  return new;
end $$;
drop trigger if exists community_sky_update_guard on public.community_skies;
create trigger community_sky_update_guard before update on public.community_skies
  for each row execute function public.community_sky_update_guard();

-- a report counts up, and the third hides the sky until an admin looks
create or replace function public.community_report_count() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update community_skies set reports = reports + 1,
    status = case when status = 'live' and reports + 1 >= 3 then 'hidden' else status end
  where id = new.sky_id;
  return new;
end $$;
drop trigger if exists community_report_count on public.community_reports;
create trigger community_report_count after insert on public.community_reports
  for each row execute function public.community_report_count();

-- one play, counted by the server (anyone may call it, only for live skies)
create or replace function public.community_play(sky uuid) returns int
language sql volatile security definer set search_path = public as $$
  update community_skies set plays = plays + 1 where id = sky and status = 'live' returning plays;
$$;

-- ---------------------------------------------------------------- row-level security

alter table public.community_admins enable row level security;
alter table public.community_allowance enable row level security;
alter table public.community_skies enable row level security;
alter table public.community_objects enable row level security;
alter table public.community_reports enable row level security;

revoke all on public.community_admins, public.community_allowance, public.community_skies,
  public.community_objects, public.community_reports from anon, authenticated;
grant select on public.community_skies, public.community_objects to anon, authenticated;
grant insert, delete on public.community_skies, public.community_objects to authenticated;
grant update (status, review_note) on public.community_skies to authenticated;
grant insert (sky_id, reason) on public.community_reports to anon, authenticated;
grant select, delete on public.community_reports to authenticated;
grant select on public.community_allowance to authenticated;
grant execute on function public.community_play(uuid), public.community_left(), public.community_is_admin() to anon, authenticated;

drop policy if exists "see live, own or as admin" on public.community_skies;
create policy "see live, own or as admin" on public.community_skies for select to anon, authenticated
  using (status = 'live' or owner = auth.uid() or public.community_is_admin());
drop policy if exists "make own" on public.community_skies;
create policy "make own" on public.community_skies for insert to authenticated with check (owner = auth.uid());
drop policy if exists "admins review" on public.community_skies;
create policy "admins review" on public.community_skies for update to authenticated
  using (public.community_is_admin()) with check (public.community_is_admin());
drop policy if exists "delete own or as admin" on public.community_skies;
create policy "delete own or as admin" on public.community_skies for delete to authenticated
  using (owner = auth.uid() or public.community_is_admin());

drop policy if exists "objects of visible skies" on public.community_objects;
create policy "objects of visible skies" on public.community_objects for select to anon, authenticated
  using (exists (select 1 from public.community_skies s where s.id = sky_id
                 and (s.status = 'live' or s.owner = auth.uid() or public.community_is_admin())));
drop policy if exists "add objects to own pending sky" on public.community_objects;
create policy "add objects to own pending sky" on public.community_objects for insert to authenticated
  with check (exists (select 1 from public.community_skies s where s.id = sky_id and s.owner = auth.uid()
                      and s.status = 'pending' and s.created_at > now() - interval '1 hour'));
drop policy if exists "delete objects of own sky" on public.community_objects;
create policy "delete objects of own sky" on public.community_objects for delete to authenticated
  using (exists (select 1 from public.community_skies s where s.id = sky_id and (s.owner = auth.uid() or public.community_is_admin())));

drop policy if exists "anyone reports a live sky" on public.community_reports;
create policy "anyone reports a live sky" on public.community_reports for insert to anon, authenticated
  with check (exists (select 1 from public.community_skies s where s.id = sky_id and s.status = 'live'));
drop policy if exists "admins read reports" on public.community_reports;
create policy "admins read reports" on public.community_reports for select to authenticated using (public.community_is_admin());
drop policy if exists "admins clear reports" on public.community_reports;
create policy "admins clear reports" on public.community_reports for delete to authenticated using (public.community_is_admin());

drop policy if exists "read own allowance" on public.community_allowance;
create policy "read own allowance" on public.community_allowance for select to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------- photos (Storage)
-- Public bucket: a photo's address is <sky id>/<n>.png and <sky id>/<n>.hi.webp, and a sky's id only becomes known
-- to other players once it is live. Uploads only into your own pending sky's folder, small images only.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('community', 'community', true, 400000, array['image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 400000, allowed_mime_types = array['image/png', 'image/webp'];

drop policy if exists "community upload to own pending sky" on storage.objects;
create policy "community upload to own pending sky" on storage.objects for insert to authenticated
  with check (bucket_id = 'community' and exists (
    select 1 from public.community_skies s where s.id::text = (storage.foldername(name))[1]
      and s.owner = auth.uid() and s.status = 'pending' and s.created_at > now() - interval '1 hour'));
drop policy if exists "community delete own or as admin" on storage.objects;
create policy "community delete own or as admin" on storage.objects for delete to authenticated
  using (bucket_id = 'community' and (public.community_is_admin() or exists (
    select 1 from public.community_skies s where s.id::text = (storage.foldername(name))[1] and s.owner = auth.uid())));
-- (removing a file needs to see it first)
drop policy if exists "community see own or as admin" on storage.objects;
create policy "community see own or as admin" on storage.objects for select to authenticated
  using (bucket_id = 'community' and (public.community_is_admin() or exists (
    select 1 from public.community_skies s where s.id::text = (storage.foldername(name))[1] and s.owner = auth.uid())));
