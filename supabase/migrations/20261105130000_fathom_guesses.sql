-- Fathom guesses: the number a player locked in on a question of Fathom (the estimation beta, #fathom), so a reveal
-- can say how real players guessed ("Players' typical guess: 4 litres · you were closer than 72%"; the game shows it
-- once 20 players have answered that question), and so a question can later be scored by how far off real players
-- are (its median and spread) once it has enough first guesses.
--
-- A guess is a number, 0 or more: an estimate, a percent, a year, or on a name-it round the figure of the thing named
-- (its population, its land borders). One row per browser and question: a browser's first guess (the same question
-- drawn again in a later game adds nothing). Anonymous like plays: client_id is the game's random per-browser id;
-- user_id is set while the player is signed in, and then they count once across their devices.
--
-- Players never touch the table: row level security on, no policies, no grants. submit_fathom_guess is the way in,
-- fathom_compare the way out (a count, a median and a share: never a row or an id). Every player counts, the owner and
-- his testers included, as in the score stats (list_stats).
--
-- The answers aren't here: the questions live in the static site (public/fathom/questions.json), so the game passes
-- fathom_compare the answer it shows and the question's round (how far off is measured on the round's own scale), and
-- a corrected answer applies to every guess at once.
--
-- Account deletion removes a player's linked guesses with their sign-in (on delete cascade); service_role gets what
-- api/delete-account.ts would need to clear them itself, as for ratings and notes.
--
-- Changed before it first ran (Nov 8), for the percent, year and name-it rounds: a guess of 0 is taken (0% and 0 land
-- borders are fair guesses; still never negative, still under 1e300), and fathom_compare takes the round (p_round:
-- estimate, percent, year, name-ratio or name-steps) and measures "further off" on its scale: how many times off for
-- an estimate and a name-it ratio list (0 counting as a tiny positive), points, years or steps off for the rest.
-- Changed again on Nov 9, still before it first ran (owner: "i want to keep me and testers in the averages"):
-- fathom_compare no longer leaves out the owners or stats_excluded (that migration is gone), so it reads only
-- fathom_guesses.
--
-- Needs none of the other migrations (only Supabase's auth.users and auth.uid()), so it runs before or after any of
-- them. Safe to run once, on a project that has never had it. Until it has run the game plays as before:
-- submit_fathom_guess answers 404 and those guesses are dropped, and the reveal shows no players' line.

create table public.fathom_guesses (
  id bigint generated always as identity primary key,
  question_id text not null check (question_id ~ '^[a-z0-9-]{1,64}$'),
  -- 0 or more, and finite: NaN (which Postgres sorts above every number) and the infinities fail this too.
  guess double precision not null check (guess >= 0 and guess < 1e300),
  client_id uuid not null,
  user_id uuid references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  -- A browser's first guess on a question is the one kept.
  constraint fathom_guesses_once unique (client_id, question_id)
);

create index fathom_guesses_by_question on public.fathom_guesses (question_id);
create index fathom_guesses_by_user on public.fathom_guesses (user_id) where user_id is not null;

alter table public.fathom_guesses enable row level security;
revoke all on table public.fathom_guesses from anon, authenticated;
grant select, delete on table public.fathom_guesses to service_role;

comment on table public.fathom_guesses is 'Fathom (beta): a browser''s first guess on each question (0 or more; a name-it round''s is the figure of the thing named). Anonymous: client_id is a random per-browser id.';

-- A guess the player locked in on a question. Checks the same things the game checks before sending
-- (src/net/fathom.ts). True when kept; false for a browser's later guess on the same question, or a browser sending
-- implausibly many (ignored); raises for anything malformed.
create or replace function public.submit_fathom_guess(
  p_question_id text,
  p_guess double precision,
  p_client_id uuid
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  kept integer;
begin
  if p_question_id is null or p_question_id !~ '^[a-z0-9-]{1,64}$' then
    raise exception 'submit_fathom_guess: bad question id' using errcode = '22023';
  end if;
  if p_guess is null or not (p_guess >= 0 and p_guess < 1e300) then
    raise exception 'submit_fathom_guess: a guess is a number, 0 or more' using errcode = '22023';
  end if;
  if p_client_id is null then
    raise exception 'submit_fathom_guess: client id missing' using errcode = '22023';
  end if;

  -- Nobody locks in 120 guesses an hour (24 games): past that, a browser is looping or scripted, and is ignored.
  if (select count(*) from public.fathom_guesses g where g.client_id = p_client_id and g.created_at > now() - interval '1 hour') >= 120 then
    return false;
  end if;

  -- abs: a -0 is kept as 0.
  insert into public.fathom_guesses (question_id, guess, client_id, user_id)
  values (p_question_id, abs(p_guess), p_client_id, uid)
  on conflict on constraint fathom_guesses_once do nothing;
  get diagnostics kept = row_count;
  return kept > 0;
end;
$$;

-- How real players guessed on a question, against p_guess (the asker's guess) and p_answer (the answer the game
-- shows), as JSON: {"n": players, "median": their median guess, "further_off": the share of them further from the
-- answer than p_guess, 0 to 1}. One guess per player (their first; a signed-in player is one player across devices).
-- Left out: only the player asking (p_client_id's browser, and their account while signed in). Everyone else counts,
-- the owners and testers included.
--
-- "Further" is on the scale of the question's round (p_round), and a tie is not further:
--   estimate, name-ratio (a name-it round on a ratio list: populations, areas): how many times off, |ln(guess / answer)|
--     (a guess half the answer is as far off as one double it), with 0 counted as 1e-300, so a 0 is further off than
--     any other guess and ties with the other 0s;
--   percent, year, name-steps (a name-it round on a steps list: land borders): points, years or steps off,
--     |guess - answer|.
-- Any other round raises (invalid_parameter_value), so a guess is never measured on the wrong scale. A guess or an
-- answer below 0 or past 1e300 gives no share. Nobody yet: {"n": 0, "median": null, "further_off": null}.
create or replace function public.fathom_compare(
  p_question_id text,
  p_round text,
  p_guess double precision,
  p_answer double precision,
  p_client_id uuid default null
) returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  times_off boolean;
  answer json;
begin
  if p_round is null or p_round not in ('estimate', 'percent', 'year', 'name-ratio', 'name-steps') then
    raise exception 'fathom_compare: unknown round' using errcode = '22023';
  end if;
  times_off := p_round in ('estimate', 'name-ratio');

  with firsts as (
    select distinct on (coalesce(g.user_id::text, g.client_id::text)) g.guess
    from public.fathom_guesses g
    where g.question_id = p_question_id
      and g.client_id is distinct from p_client_id
      and (auth.uid() is null or g.user_id is distinct from auth.uid())
    order by coalesce(g.user_id::text, g.client_id::text), g.created_at
  ),
  -- How far off each first guess is, and the asker's (mine), on the round's scale, rounded so float noise never
  -- breaks a tie.
  off as (
    select x.mine, round((
      case when times_off then abs(ln(greatest(x.guess, 1e-300)) - ln(greatest(p_answer, 1e-300)))
      else abs(x.guess - p_answer) end
    )::numeric, 9) as d
    from (
      select false as mine, f.guess from firsts f
      union all
      select true, p_guess where p_guess >= 0 and p_guess < 1e300
    ) x
    where p_answer >= 0 and p_answer < 1e300
  )
  select json_build_object(
    'n', (select count(*) from firsts)::integer,
    'median', (select percentile_disc(0.5) within group (order by f.guess) from firsts f),
    'further_off', (select round(avg(case when o.d > m.d then 1 else 0 end), 4) from off o join off m on m.mine where not o.mine)
  ) into answer;
  return answer;
end;
$$;

revoke all on function public.submit_fathom_guess(text, double precision, uuid) from public;
revoke all on function public.fathom_compare(text, text, double precision, double precision, uuid) from public;
grant execute on function public.submit_fathom_guess(text, double precision, uuid) to anon, authenticated;
grant execute on function public.fathom_compare(text, text, double precision, double precision, uuid) to anon, authenticated;
