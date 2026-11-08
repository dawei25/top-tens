-- Missed guesses: what players type on a list or a Blitz round that the game doesn't take, so the improvement loop
-- (docs/IMPROVE.md, step 0) fixes the most common misses from real data: an alias, a missing answer, a better
-- "isn't in this ranking" line, a false "That doesn't look like an answer".
--
-- Kind: unknown (not an answer on this list) or junk (doesn't look like an answer at all; kept so false junk calls can
-- be found). Never an accepted answer, a near miss (a real answer outside the top 10), a "did you mean" choice or
-- anything from Fathom: the game sends none of those (src/net/misses.ts).
--
-- Linked to nobody. There is no user_id, and client_id is a random id the game keeps for misses alone, not the one
-- plays, ratings, notes and Fathom guesses carry, so a miss can't be joined to a signed-in player's rows (the game also
-- sends it with the public key only, never the player's session). It is there for the hourly limit and so a browser
-- counts once per text, nothing else. The text is normalized as the game normalizes it (cleanMiss: lowercase, NFC,
-- every run of blanks one space, trimmed), 1 to 40 characters, and never anything that looks like an email address, a
-- phone number or a link (the patterns are the game's own strings, misses.test.ts compares them).
--
-- Players never touch the table (row level security on, no policies, no grants): submit_miss is the way in, and
-- list_misses the way out: totals per text, never a client id, and only with the reader key, the one list_feedback
-- takes (as p_reader, or in the X-Feedback-Reader header the loop's cloud environment adds).
--
-- Account deletion (api/delete-account.ts) has nothing to remove here, as no row is anyone's, so unlike ratings,
-- notes and Fathom guesses there is no grant for service_role.
--
-- Run after 20261104130000_feedback_reader_header.sql (list_misses reads private.reader_keys). Safe to run once. Until
-- it has run the game plays as before: submit_miss answers 404 and those misses are dropped.

create table public.missed_guesses (
  id bigint generated always as identity primary key,
  list_id text not null check (list_id ~ '^[a-z0-9-]{1,64}$'),
  mode text not null check (mode in ('list', 'blitz')),
  kind text not null check (kind in ('unknown', 'junk')),
  text text not null check (char_length(text) between 1 and 40),
  client_id uuid not null,
  created_at timestamptz not null default now(),
  -- A browser counts once per text on a list in a mode.
  constraint missed_guesses_once unique (client_id, list_id, mode, text)
);

create index missed_guesses_by_time on public.missed_guesses (created_at);
create index missed_guesses_by_client on public.missed_guesses (client_id, created_at);

alter table public.missed_guesses enable row level security;
revoke all on table public.missed_guesses from anon, authenticated;

comment on table public.missed_guesses is 'Guesses the game didn''t take (unknown or junk), as normalized text. Linked to nobody: client_id is a random id kept for this alone. Read only through list_misses, with the reader key.';

-- A guess the game didn't take. Checks and normalizes the way the game does before sending (src/net/misses.ts). True
-- when kept; false for a text this browser already sent on this list in this mode, or a browser sending implausibly
-- many (ignored); raises for anything malformed, or text that looks like an email address, a phone number or a link.
create or replace function public.submit_miss(
  p_list_id text,
  p_mode text,
  p_kind text,
  p_text text,
  p_client_id uuid
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  body text;
  kept integer;
begin
  if p_list_id is null or p_list_id !~ '^[a-z0-9-]{1,64}$' then
    raise exception 'submit_miss: bad list id' using errcode = '22023';
  end if;
  if p_mode is null or p_mode not in ('list', 'blitz') then
    raise exception 'submit_miss: mode must be list or blitz' using errcode = '22023';
  end if;
  if p_kind is null or p_kind not in ('unknown', 'junk') then
    raise exception 'submit_miss: kind must be unknown or junk' using errcode = '22023';
  end if;
  if p_client_id is null then
    raise exception 'submit_miss: client id missing' using errcode = '22023';
  end if;

  -- cleanMiss: lowercase, composed, every run of control characters and blanks one space, trimmed.
  body := pg_catalog.btrim(
    pg_catalog.regexp_replace(
      pg_catalog.normalize(pg_catalog.lower(p_text), 'NFC'),
      '[\u0001-\u0020\u007f-\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+', ' ', 'g'),
    ' ');
  if body is null or char_length(body) < 1 or char_length(body) > 40 then
    raise exception 'submit_miss: a miss is 1 to 40 characters' using errcode = '22023';
  end if;
  -- An email address, a phone number, a link: nobody's guess, maybe somebody's details. Never kept.
  if body ~ '[^ @]+@[^ @]+\.[^ @]+'
    or body ~ '[0-9]([ ()./-]{0,2}[0-9]){6,}'
    or body ~ '[a-z][a-z0-9+.-]*://|(^| )www\.|[a-z0-9-]\.[a-z]{2,}/' then
    raise exception 'submit_miss: looks like an email address, a phone number or a link' using errcode = '22023';
  end if;

  -- Nobody misses 60 different ways an hour: past that, a browser is looping or scripted, and its misses are ignored.
  if (select count(*) from public.missed_guesses m where m.client_id = p_client_id and m.created_at > now() - interval '1 hour') >= 60 then
    return false;
  end if;

  insert into public.missed_guesses (list_id, mode, kind, text, client_id)
  values (p_list_id, p_mode, p_kind, body, p_client_id)
  on conflict on constraint missed_guesses_once do nothing;
  get diagnostics kept = row_count;
  return kept > 0;
end;
$$;

-- The misses, for the improvement loop: one row per list, mode, kind and text, with how many browsers typed it and
-- when the latest did; most browsers first, then the most recent. No client ids. Only with the reader key, exactly as
-- list_feedback: p_reader, or when that is empty the X-Feedback-Reader header (raises otherwise, also before a key is
-- set). p_since: only misses typed since then.
create or replace function public.list_misses(p_reader text, p_since timestamptz default null)
returns table (
  list_id text,
  mode text,
  kind text,
  text text,
  browsers integer,
  last_seen timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  reader text := nullif(p_reader, '');
begin
  if reader is null then
    begin
      reader := nullif(nullif(pg_catalog.current_setting('request.headers', true), '')::json ->> 'x-feedback-reader', '');
    exception when others then
      -- Malformed headers: no key.
      reader := null;
    end;
  end if;
  if reader is null or not exists (
    select 1 from private.reader_keys k
    where k.name = 'feedback' and k.key_hash = pg_catalog.sha256(pg_catalog.convert_to(reader, 'UTF8'))
  ) then
    raise exception 'list_misses: wrong reader key' using errcode = '42501';
  end if;
  return query
    select m.list_id, m.mode, m.kind, m.text, count(distinct m.client_id)::integer, max(m.created_at)
    from public.missed_guesses m
    where p_since is null or m.created_at >= p_since
    group by m.list_id, m.mode, m.kind, m.text
    order by count(distinct m.client_id) desc, max(m.created_at) desc, m.list_id, m.mode, m.text;
end;
$$;

revoke all on function public.submit_miss(text, text, text, text, uuid) from public;
revoke all on function public.list_misses(text, timestamptz) from public;
grant execute on function public.submit_miss(text, text, text, text, uuid) to anon, authenticated;
grant execute on function public.list_misses(text, timestamptz) to anon, authenticated;
