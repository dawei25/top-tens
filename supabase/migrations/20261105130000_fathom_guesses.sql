-- Fathom guesses: the number a player locked in on a question of Fathom (the estimation beta, #fathom), so a reveal
-- can say how real players guessed ("Players' typical guess: 4 litres · you were closer than 72%"; the game shows it
-- once 20 players have answered that question).
--
-- One row per browser and question: a browser's first guess (the same question drawn again in a later game adds
-- nothing). Anonymous like plays: client_id is the game's random per-browser id; user_id is set while the player is
-- signed in, and then they count once across their devices.
--
-- Players never touch the table: row level security on, no policies, no grants. submit_fathom_guess is the way in,
-- fathom_compare the way out (a count, a median and a share: never a row or an id). The owners and the accounts in
-- stats_excluded are left out of the comparison, as they are out of the score stats (20261105120000).
--
-- The answers aren't here: the questions live in the static site (public/fathom/questions.json), so the game passes
-- fathom_compare the answer it shows, and a corrected answer applies to every guess at once.
--
-- Account deletion removes a player's linked guesses with their sign-in (on delete cascade); service_role gets what
-- api/delete-account.ts would need to clear them itself, as for ratings and notes.
--
-- Run after 20261105120000_stats_exclusions.sql (it reads owners, stats_excluded, plays, ratings and feedback). Safe to
-- run once. Until it has run the game plays as before: submit_fathom_guess answers 404 and those guesses are dropped,
-- and the reveal shows no players' line.

create table public.fathom_guesses (
  id bigint generated always as identity primary key,
  question_id text not null check (question_id ~ '^[a-z0-9-]{1,64}$'),
  -- Above zero and finite: NaN and Infinity fail this too.
  guess double precision not null check (guess > 0 and guess < 1e300),
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

comment on table public.fathom_guesses is 'Fathom (beta): a browser''s first guess on each question. Anonymous: client_id is a random per-browser id.';

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
  if p_guess is null or not (p_guess > 0 and p_guess < 1e300) then
    raise exception 'submit_fathom_guess: a guess is a positive number' using errcode = '22023';
  end if;
  if p_client_id is null then
    raise exception 'submit_fathom_guess: client id missing' using errcode = '22023';
  end if;

  -- Nobody locks in 120 guesses an hour (24 games): past that, a browser is looping or scripted, and is ignored.
  if (select count(*) from public.fathom_guesses g where g.client_id = p_client_id and g.created_at > now() - interval '1 hour') >= 120 then
    return false;
  end if;

  insert into public.fathom_guesses (question_id, guess, client_id, user_id)
  values (p_question_id, p_guess, p_client_id, uid)
  on conflict on constraint fathom_guesses_once do nothing;
  get diagnostics kept = row_count;
  return kept > 0;
end;
$$;

-- How real players guessed on a question, against p_guess (the asker's guess) and p_answer (the answer the game
-- shows), as JSON: {"n": players, "median": their median guess, "further_off": the share of them further from the
-- answer than p_guess, 0 to 1}. One guess per player (their first; a signed-in player is one player across devices).
-- Left out: the owners and stats_excluded (their accounts' guesses, and those sent signed out from any browser they
-- have used signed in), and the player asking (p_client_id's browser, and their account while signed in). "Further"
-- is on the game's scale, how many times off (a guess half the answer is as far off as one double it), and a tie is
-- not further. Nobody yet: {"n": 0, "median": null, "further_off": null}.
create or replace function public.fathom_compare(
  p_question_id text,
  p_guess double precision,
  p_answer double precision,
  p_client_id uuid default null
) returns json
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
  -- Browsers an excluded player has used signed in: their guesses there signed out are theirs too.
  excluded_clients as (
    select p.client_id from public.plays p join excluded e on e.user_id = p.user_id
    union
    select r.client_id from public.ratings r join excluded e on e.user_id = r.user_id
    union
    select f.client_id from public.feedback f join excluded e on e.user_id = f.user_id
    union
    select g.client_id from public.fathom_guesses g join excluded e on e.user_id = g.user_id
  ),
  firsts as (
    select distinct on (coalesce(g.user_id::text, g.client_id::text)) g.guess
    from public.fathom_guesses g
    where g.question_id = p_question_id
      and not exists (select 1 from excluded e where e.user_id = g.user_id)
      and (g.user_id is not null or not exists (select 1 from excluded_clients c where c.client_id = g.client_id))
      and g.client_id is distinct from p_client_id
      and (auth.uid() is null or g.user_id is distinct from auth.uid())
    order by coalesce(g.user_id::text, g.client_id::text), g.created_at
  ),
  -- How far off each is, in the same terms: |ln(guess) - ln(answer)|, rounded so float noise never breaks a tie.
  off as (
    select round(abs(ln(f.guess) - ln(p_answer))::numeric, 9) as d from firsts f
    where p_answer > 0 and p_answer < 1e300
  ),
  mine as (
    select round(abs(ln(p_guess) - ln(p_answer))::numeric, 9) as d
    where p_guess > 0 and p_guess < 1e300 and p_answer > 0 and p_answer < 1e300
  )
  select json_build_object(
    'n', (select count(*) from firsts)::integer,
    'median', (select percentile_disc(0.5) within group (order by f.guess) from firsts f),
    'further_off', (select round(avg(case when o.d > m.d then 1 else 0 end), 4) from off o, mine m)
  );
$$;

revoke all on function public.submit_fathom_guess(text, double precision, uuid) from public;
revoke all on function public.fathom_compare(text, double precision, double precision, uuid) from public;
grant execute on function public.submit_fathom_guess(text, double precision, uuid) to anon, authenticated;
grant execute on function public.fathom_compare(text, double precision, double precision, uuid) to anon, authenticated;
