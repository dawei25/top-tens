-- Testers out of the public numbers.
--
-- The results' players' average, histogram and "better than X%" (list_stats) and Stats' "Vs players" (list_averages)
-- leave out the owner (public.owners) and the accounts in public.stats_excluded: testers and friends who know the
-- lists and would skew the first real numbers. The game blends real players into its estimate (src/net/crowd.ts), so
-- the first few dozen players weigh the most; they should be players, not the people who built the lists.
--
-- An excluded player is left out whether they played signed in or not: their account's games, and the games sent
-- signed out from any browser they have used signed in (one that sent a game, a rating or a note under their
-- account). Someone else signed in on that browser still counts.
--
-- stats_excluded is filled by hand in the SQL editor, like owners (docs/BACKEND.md, step 2.7). Players can't read or
-- touch it: row level security on, no grants. Deleting an account deletes its row.
--
-- list_stats and list_averages keep their signatures and what they return, so the game works the same before and
-- after this runs. Run after 20261104120000_feedback.sql (owners) and 20261103120000_ratings.sql. Safe to run again.

create table if not exists public.stats_excluded (
  user_id uuid primary key references auth.users (id) on delete cascade,
  added_at timestamptz not null default now()
);

alter table public.stats_excluded enable row level security;
revoke all on table public.stats_excluded from anon, authenticated;

comment on table public.stats_excluded is 'Accounts left out of the public score stats (testers, friends). Added in the SQL editor (docs/BACKEND.md).';

-- Real players' scores on one list in one mode, as JSON: {"n": players, "counts": [...], "avg": mean}.
-- One score per player (their first game on the list in that mode), so replays and repeat visits don't tilt it; a
-- signed-in player is one player across devices. Lists: 11 counts, for scores 0 to 10. Blitz: one count per 50 points
-- (0-49, 50-99, ...), up to the highest bucket anyone reached. The owner and stats_excluded are left out.
create or replace function public.list_stats(p_list_id text, p_mode text default 'list')
returns json
language sql
stable
security definer
set search_path = ''
as $$
  with excluded as (
    select o.user_id from public.owners o
    union
    select x.user_id from public.stats_excluded x
  ),
  -- Browsers an excluded player has used signed in: their games there signed out are theirs too.
  excluded_clients as (
    select p.client_id from public.plays p join excluded e on e.user_id = p.user_id
    union
    select r.client_id from public.ratings r join excluded e on e.user_id = r.user_id
    union
    select f.client_id from public.feedback f join excluded e on e.user_id = f.user_id
  ),
  firsts as (
    select distinct on (coalesce(p.user_id::text, p.client_id::text)) p.score
    from public.plays p
    where p.list_id = p_list_id and p.mode = p_mode
      and not exists (select 1 from excluded e where e.user_id = p.user_id)
      and (p.user_id is not null or not exists (select 1 from excluded_clients c where c.client_id = p.client_id))
    order by coalesce(p.user_id::text, p.client_id::text), p.started_at
  ),
  buckets as (
    select case when p_mode = 'list' then f.score else least(f.score / 50, 100) end as bucket, count(*)::integer as players
    from firsts f
    group by 1
  )
  select json_build_object(
    'n', coalesce((select sum(b.players) from buckets b), 0)::integer,
    'counts', coalesce(
      (
        select json_agg(coalesce(b.players, 0) order by g.i)
        from generate_series(0, case when p_mode = 'list' then 10 else coalesce((select max(bucket) from buckets), -1) end) as g(i)
        left join buckets b on b.bucket = g.i
      ),
      '[]'::json
    ),
    'avg', (select round(avg(f.score)::numeric, 2) from firsts f)
  );
$$;

-- Every list's real average in a mode (one score per player, as in list_stats, with the same players left out), for
-- the knowledge page. Category averages come from these and the categories in public/puzzles/index.json, on the client.
create or replace function public.list_averages(p_mode text default 'list')
returns table (list_id text, n integer, avg numeric)
language sql
stable
security definer
set search_path = ''
as $$
  with excluded as (
    select o.user_id from public.owners o
    union
    select x.user_id from public.stats_excluded x
  ),
  excluded_clients as (
    select p.client_id from public.plays p join excluded e on e.user_id = p.user_id
    union
    select r.client_id from public.ratings r join excluded e on e.user_id = r.user_id
    union
    select f.client_id from public.feedback f join excluded e on e.user_id = f.user_id
  )
  select f.list_id, count(*)::integer, round(avg(f.score)::numeric, 2)
  from (
    select distinct on (p.list_id, coalesce(p.user_id::text, p.client_id::text)) p.list_id, p.score
    from public.plays p
    where p.mode = p_mode
      and not exists (select 1 from excluded e where e.user_id = p.user_id)
      and (p.user_id is not null or not exists (select 1 from excluded_clients c where c.client_id = p.client_id))
    order by p.list_id, coalesce(p.user_id::text, p.client_id::text), p.started_at
  ) f
  group by f.list_id
  order by f.list_id;
$$;

-- The same grants as before (create or replace keeps them; stated again so this file stands on its own).
revoke all on function public.list_stats(text, text) from public;
revoke all on function public.list_averages(text) from public;
grant execute on function public.list_stats(text, text) to anon, authenticated;
grant execute on function public.list_averages(text) to anon, authenticated;
