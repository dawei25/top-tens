-- Phase 1: anonymous score stats.
--
-- One row per finished game: the list, the mode, the score and when it started. No names, emails or IP addresses.
-- client_id is a random id the game makes per browser, only so the same game isn't counted twice. user_id stays
-- empty unless the player is signed in (phase 2).
--
-- Players never touch the table directly: row level security is on with no policies, and the three functions below
-- are the only way in (submit_play to add a game, list_stats and list_averages to read totals).

create table public.plays (
  id bigint generated always as identity primary key,
  list_id text not null check (list_id ~ '^[a-z0-9-]{1,64}$'),
  mode text not null check (mode in ('list', 'blitz')),
  -- Set when the game was that date's daily, played on its date.
  daily_date date,
  -- List: answers found, 0-10. Blitz: points, 0-5000.
  score integer not null check (score >= 0),
  -- Answers found (lists: the same as score).
  found integer check (found >= 0),
  client_id uuid not null,
  user_id uuid references auth.users (id) on delete cascade,
  started_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint plays_score_range check (
    (mode = 'list' and score <= 10 and coalesce(found, 0) <= 10)
    or (mode = 'blitz' and score <= 5000 and coalesce(found, 0) <= 1000)
  ),
  -- The same game sent twice (a retry, a reload) is one row.
  constraint plays_once unique (client_id, list_id, mode, started_at)
);

create index plays_by_list on public.plays (list_id, mode);
create index plays_by_user on public.plays (user_id) where user_id is not null;

alter table public.plays enable row level security;
revoke all on table public.plays from anon, authenticated;

comment on table public.plays is 'Finished games for the score stats. Anonymous: client_id is a random per-browser id.';

-- Add a finished game. Checks the same things the game checks before sending (src/net/plays.ts): a list id's shape,
-- scores in range, a start within the last day, a daily date within a day of today. Returns false for a duplicate
-- (or a browser sending implausibly many games); raises for anything malformed.
create or replace function public.submit_play(
  p_list_id text,
  p_mode text,
  p_score integer,
  p_found integer,
  p_client_id uuid,
  p_started_at timestamptz,
  p_daily_date date default null
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := (now() at time zone 'utc')::date;
  added integer;
begin
  if p_list_id is null or p_list_id !~ '^[a-z0-9-]{1,64}$' then
    raise exception 'submit_play: bad list id' using errcode = '22023';
  end if;
  if p_mode is null or p_mode not in ('list', 'blitz') then
    raise exception 'submit_play: mode must be list or blitz' using errcode = '22023';
  end if;
  -- (The CASE needs its parentheses: inside IF, a bare CASE's THEN would end the condition.)
  if p_score is null or p_score < 0 or p_score > (case p_mode when 'list' then 10 else 5000 end) then
    raise exception 'submit_play: score out of range' using errcode = '22023';
  end if;
  if p_found is null or p_found < 0 or p_found > (case p_mode when 'list' then 10 else 1000 end) then
    raise exception 'submit_play: found out of range' using errcode = '22023';
  end if;
  if p_client_id is null then
    raise exception 'submit_play: client id missing' using errcode = '22023';
  end if;
  if p_started_at is null or p_started_at > now() + interval '5 minutes' or p_started_at < now() - interval '1 day' then
    raise exception 'submit_play: the game must have started within the last day' using errcode = '22023';
  end if;
  if p_daily_date is not null and (p_daily_date < today - 1 or p_daily_date > today + 1) then
    raise exception 'submit_play: daily date must be within a day of today' using errcode = '22023';
  end if;

  -- Nobody finishes 120 games an hour: past that, a browser is looping or scripted, and its games are ignored.
  if (select count(*) from public.plays where client_id = p_client_id and created_at > now() - interval '1 hour') >= 120 then
    return false;
  end if;

  insert into public.plays (list_id, mode, daily_date, score, found, client_id, user_id, started_at)
  values (p_list_id, p_mode, p_daily_date, p_score, p_found, p_client_id, auth.uid(), p_started_at)
  on conflict on constraint plays_once do nothing;
  get diagnostics added = row_count;
  return added > 0;
end;
$$;

-- Real players' scores on one list in one mode, as JSON: {"n": players, "counts": [...], "avg": mean}.
-- One score per player (their first game on the list in that mode), so replays and repeat visits don't tilt it; a
-- signed-in player is one player across devices. Lists: 11 counts, for scores 0 to 10. Blitz: one count per 50 points
-- (0-49, 50-99, ...), up to the highest bucket anyone reached.
create or replace function public.list_stats(p_list_id text, p_mode text default 'list')
returns json
language sql
stable
security definer
set search_path = ''
as $$
  with firsts as (
    select distinct on (coalesce(p.user_id::text, p.client_id::text)) p.score
    from public.plays p
    where p.list_id = p_list_id and p.mode = p_mode
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

-- Every list's real average in a mode (one score per player, as in list_stats), for the knowledge page.
-- Category averages come from these and the categories in public/puzzles/index.json, on the client.
create or replace function public.list_averages(p_mode text default 'list')
returns table (list_id text, n integer, avg numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select f.list_id, count(*)::integer, round(avg(f.score)::numeric, 2)
  from (
    select distinct on (p.list_id, coalesce(p.user_id::text, p.client_id::text)) p.list_id, p.score
    from public.plays p
    where p.mode = p_mode
    order by p.list_id, coalesce(p.user_id::text, p.client_id::text), p.started_at
  ) f
  group by f.list_id
  order by f.list_id;
$$;

revoke all on function public.submit_play(text, text, integer, integer, uuid, timestamptz, date) from public;
revoke all on function public.list_stats(text, text) from public;
revoke all on function public.list_averages(text) from public;
grant execute on function public.submit_play(text, text, integer, integer, uuid, timestamptz, date) to anon, authenticated;
grant execute on function public.list_stats(text, text) to anon, authenticated;
grant execute on function public.list_averages(text) to anon, authenticated;
