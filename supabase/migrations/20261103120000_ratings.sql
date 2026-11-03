-- Ratings: "Good list?" on the results of a list game or a Blitz round, a thumbs up or down.
--
-- One row per browser, list and mode: a player's latest answer replaces their earlier one, and taking it back deletes
-- the row. A thumbs down may carry one reason from a short fixed set. Anonymous like plays: client_id is the game's
-- random per-browser id; user_id is set while the player is signed in, and then they keep one rating per list and
-- mode across their devices.
--
-- Players never touch the table: row level security is on with no policies, and two functions are the way in
-- (rate_list to rate, list_ratings to read the totals, without any ids). Account deletion (api/delete-account.ts, as
-- service_role) deletes a player's linked ratings: projects created with "Automatically expose new tables" off don't
-- hand new tables to service_role, so that is granted here too.
--
-- Needs nothing from the earlier migrations (only Supabase's own roles and auth.users). Safe to run once.

create table public.ratings (
  id bigint generated always as identity primary key,
  list_id text not null check (list_id ~ '^[a-z0-9-]{1,64}$'),
  mode text not null check (mode in ('list', 'blitz')),
  rating smallint not null check (rating in (-1, 1)),
  -- Why not, after a thumbs down: the game's fixed set (RATING_REASONS in src/net/ratings.ts).
  reason text check (reason in ('too-hard', 'too-easy', 'boring', 'unfair', 'wrong-data')),
  client_id uuid not null,
  user_id uuid references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ratings_reason_down check (reason is null or rating = -1),
  -- A player's latest rating of a list in a mode replaces the earlier one.
  constraint ratings_once unique (client_id, list_id, mode)
);

create index ratings_by_list on public.ratings (list_id, mode);
create index ratings_by_user on public.ratings (user_id) where user_id is not null;

alter table public.ratings enable row level security;
revoke all on table public.ratings from anon, authenticated;
grant select, delete on table public.ratings to service_role;

comment on table public.ratings is 'Thumbs up or down on a list, one per player, list and mode. Anonymous: client_id is a random per-browser id.';

-- Rate a list in a mode: 1 (good list), -1 (not), or 0 to take a rating back. A reason only goes with -1. Checks the
-- same things the game checks before sending (src/net/ratings.ts). Returns false for a browser sending implausibly
-- many ratings (ignored); raises for anything malformed.
create or replace function public.rate_list(
  p_list_id text,
  p_mode text,
  p_rating integer,
  p_reason text,
  p_client_id uuid
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if p_list_id is null or p_list_id !~ '^[a-z0-9-]{1,64}$' then
    raise exception 'rate_list: bad list id' using errcode = '22023';
  end if;
  if p_mode is null or p_mode not in ('list', 'blitz') then
    raise exception 'rate_list: mode must be list or blitz' using errcode = '22023';
  end if;
  if p_rating is null or p_rating not in (-1, 0, 1) then
    raise exception 'rate_list: rating must be 1, -1, or 0 to take it back' using errcode = '22023';
  end if;
  if p_reason is not null and p_reason not in ('too-hard', 'too-easy', 'boring', 'unfair', 'wrong-data') then
    raise exception 'rate_list: unknown reason' using errcode = '22023';
  end if;
  if p_reason is not null and p_rating <> -1 then
    raise exception 'rate_list: a reason goes with a thumbs down' using errcode = '22023';
  end if;
  if p_client_id is null then
    raise exception 'rate_list: client id missing' using errcode = '22023';
  end if;

  -- Nobody rates 120 lists an hour: past that, a browser is looping or scripted, and its ratings are ignored.
  if (select count(*) from public.ratings where client_id = p_client_id and updated_at > now() - interval '1 hour') >= 120 then
    return false;
  end if;

  -- Signed in, a player has one rating per list and mode, from whichever device gave it last.
  if uid is not null then
    delete from public.ratings r
    where r.user_id = uid and r.list_id = p_list_id and r.mode = p_mode and r.client_id <> p_client_id;
  end if;

  if p_rating = 0 then
    delete from public.ratings r where r.client_id = p_client_id and r.list_id = p_list_id and r.mode = p_mode;
    return true;
  end if;

  insert into public.ratings (list_id, mode, rating, reason, client_id, user_id)
  values (p_list_id, p_mode, p_rating, p_reason, p_client_id, uid)
  on conflict on constraint ratings_once do update
    set rating = excluded.rating, reason = excluded.reason, user_id = excluded.user_id, updated_at = now();
  return true;
end;
$$;

-- Every rated list's totals per mode, for the improvement loop (readable with the public key: no ids, only counts).
-- One rating per player (their latest; a signed-in player is one player across devices). p_since: only ratings given
-- or changed since then. last_rated: the newest of them.
create or replace function public.list_ratings(p_since timestamptz default null)
returns table (
  list_id text,
  mode text,
  up integer,
  down integer,
  too_hard integer,
  too_easy integer,
  boring integer,
  unfair integer,
  wrong_data integer,
  last_rated timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    r.list_id,
    r.mode,
    (count(*) filter (where r.rating = 1))::integer,
    (count(*) filter (where r.rating = -1))::integer,
    (count(*) filter (where r.reason = 'too-hard'))::integer,
    (count(*) filter (where r.reason = 'too-easy'))::integer,
    (count(*) filter (where r.reason = 'boring'))::integer,
    (count(*) filter (where r.reason = 'unfair'))::integer,
    (count(*) filter (where r.reason = 'wrong-data'))::integer,
    max(r.updated_at)
  from (
    select distinct on (x.list_id, x.mode, coalesce(x.user_id::text, x.client_id::text)) x.list_id, x.mode, x.rating, x.reason, x.updated_at
    from public.ratings x
    order by x.list_id, x.mode, coalesce(x.user_id::text, x.client_id::text), x.updated_at desc
  ) r
  where p_since is null or r.updated_at >= p_since
  group by r.list_id, r.mode
  order by r.list_id, r.mode;
$$;

revoke all on function public.rate_list(text, text, integer, text, uuid) from public;
revoke all on function public.list_ratings(timestamptz) from public;
grant execute on function public.rate_list(text, text, integer, text, uuid) to anon, authenticated;
grant execute on function public.list_ratings(timestamptz) to anon, authenticated;
