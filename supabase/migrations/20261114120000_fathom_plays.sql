-- Today's Fathom totals (owner, Nov 14): Fathom became a daily, the same ten questions for everyone each day (ten
-- since the owner's "change it to 10 questions", the same day, before this was first run), so a day's totals compare
-- directly. The results say "you did better than 81% of players today" with a histogram of the
-- day's totals: a simulated crowd (30 virtual players, src/game/fathom-crowd.ts) blended with the real totals read
-- here, as lists blend their estimate with list_stats (docs/BACKEND.md, How the averages blend).
--
-- One row per browser and date: the total (0 to 1000) of that date's Fathom, played on its date, sent once when the
-- game finishes. Anonymous like plays: client_id is the game's random per-browser id; user_id is set while the
-- player is signed in, and then they count once across their devices (their first total that day).
--
-- Players never touch the table: row level security on, no policies, no grants. submit_fathom_play is the way in,
-- fathom_day_stats the way out (how many players, their totals in bins of 10, and the mean: never a row or an id).
-- Everyone counts, the owner and his testers included, as in list_stats.
--
-- No hourly limit, unlike submit_play: one row per browser and date, and a date within a day of today, so a browser
-- adds at most three rows, ever, in any three days.
--
-- Account deletion removes a player's linked totals with their sign-in (on delete cascade); service_role gets what
-- api/delete-account.ts would need to clear them itself, as for ratings, notes and Fathom guesses.
--
-- Needs none of the other migrations (only Supabase's auth.users and auth.uid()). Safe to run once, or again: the
-- table and its indexes are made only if missing, the functions replaced, the grants set as they were. Until it has
-- run the game plays as before: submit_fathom_play answers 404 and those totals are dropped, and fathom_day_stats
-- answers 404, so the results show the simulated crowd alone.

create table if not exists public.fathom_plays (
  id bigint generated always as identity primary key,
  -- The player's own date (their local day), within a day of the server's when it was sent.
  daily_date date not null,
  total integer not null check (total >= 0 and total <= 1000),
  client_id uuid not null,
  user_id uuid references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  -- A browser's first total on a date is the one kept.
  constraint fathom_plays_once unique (client_id, daily_date)
);

create index if not exists fathom_plays_by_date on public.fathom_plays (daily_date);
create index if not exists fathom_plays_by_user on public.fathom_plays (user_id) where user_id is not null;

alter table public.fathom_plays enable row level security;
revoke all on table public.fathom_plays from anon, authenticated;
grant select, delete on table public.fathom_plays to service_role;

comment on table public.fathom_plays is 'Today''s Fathom: a browser''s total (0-1000) on each date''s ten questions, played on its date. Anonymous: client_id is a random per-browser id.';

-- A finished Today's Fathom. Checks the same things the game checks before sending (src/net/fathom.ts,
-- invalidFathomPlay): a date within a day of today, a whole total 0 to 1000. True when kept; false for a browser's
-- later total on the same date; raises for anything malformed.
create or replace function public.submit_fathom_play(
  p_date date,
  p_total integer,
  p_client_id uuid
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := (now() at time zone 'utc')::date;
  kept integer;
begin
  if p_date is null or p_date < today - 1 or p_date > today + 1 then
    raise exception 'submit_fathom_play: the date must be within a day of today' using errcode = '22023';
  end if;
  if p_total is null or p_total < 0 or p_total > 1000 then
    raise exception 'submit_fathom_play: a total is 0 to 1000' using errcode = '22023';
  end if;
  if p_client_id is null then
    raise exception 'submit_fathom_play: client id missing' using errcode = '22023';
  end if;

  insert into public.fathom_plays (daily_date, total, client_id, user_id)
  values (p_date, p_total, p_client_id, auth.uid())
  on conflict on constraint fathom_plays_once do nothing;
  get diagnostics kept = row_count;
  return kept > 0;
end;
$$;

-- Real players' totals on a date's Fathom, as JSON: {"n": players, "counts": [100 bins], "avg": mean}. One total per
-- player (their first that date; a signed-in player is one player across devices), everyone counted. The bins are 10
-- points wide, 0-9 to 990-1000 (1000 shares the last; src/net/fathom.ts totalBin), always all 100. Nobody yet:
-- {"n": 0, "counts": [0, ...], "avg": null}.
create or replace function public.fathom_day_stats(p_date date)
returns json
language sql
stable
security definer
set search_path = ''
as $$
  with firsts as (
    select distinct on (coalesce(p.user_id::text, p.client_id::text)) p.total
    from public.fathom_plays p
    where p.daily_date = p_date
    order by coalesce(p.user_id::text, p.client_id::text), p.created_at, p.id
  ),
  bins as (
    select least(f.total / 10, 99) as bin, count(*)::integer as players
    from firsts f
    group by 1
  )
  select json_build_object(
    'n', (select count(*) from firsts)::integer,
    'counts', (
      select json_agg(coalesce(b.players, 0) order by g.i)
      from generate_series(0, 99) as g(i)
      left join bins b on b.bin = g.i
    ),
    'avg', (select round(avg(f.total)::numeric, 2) from firsts f)
  );
$$;

revoke all on function public.submit_fathom_play(date, integer, uuid) from public;
revoke all on function public.fathom_day_stats(date) from public;
grant execute on function public.submit_fathom_play(date, integer, uuid) to anon, authenticated;
grant execute on function public.fathom_day_stats(date) to anon, authenticated;
