-- Fathom misses: a name typed on a Fathom name-it round ("Name a city with about 10 million people") that the round
-- doesn't take, kept like a list's or a Blitz round's missed guess, so the improvement loop (docs/IMPROVE.md, step 0)
-- sees what players expect a round to take (the owner, Nov 17: "are wrong guesses tracked for fathom? i guessed rome
-- for a city based question but it wasnt accepted so was wondering if ud take in the feedback automatically").
--
-- A Fathom miss is a row in missed_guesses with mode 'fathom' and the question's id as list_id (a question id has a
-- list id's shape: public/fathom/questions.json, kebab-case, at most 64 characters). Kind as for lists: unknown (no name
-- the round takes: not on its list, a thing of another kind, a city it has no figure for) or junk. Only the name-it
-- round sends any: the number rounds' guesses are in fathom_guesses, never here (src/net/misses.ts, nameMissKind).
-- Everything else is as for lists: the text normalized the same way, 1 to 40 characters, never an email address, a
-- phone number or a link, a browser's text on a question once, the same hourly limit (shared with lists and Blitz),
-- linked to nobody.
--
-- What changes: the mode check on missed_guesses and in submit_miss (same signature, same checks otherwise, same
-- grants). list_misses is not touched: it totals by list_id, mode, kind and text as stored, so Fathom's rows come out
-- under mode 'fathom', and it still answers only to the reader key.
--
-- Needs 20261108120000_missed_guesses.sql (and nothing after it). Safe to run once, and again: the check is dropped and
-- added back, the function replaced. Until it has run, submit_miss refuses mode 'fathom' (a 400 from the API) and the
-- game drops those misses quietly, as it does any refused one.
--
-- Check it took: on #fathom, type a city no list has ("Atlantis") on a name-it round and press LOCK IN: the network tab
-- shows rpc/submit_miss with p_mode "fathom" and the question's id as p_list_id, answering true; then in the SQL Editor
-- `select * from list_misses('<your reader key>') where mode = 'fathom';` has that row.

-- The table: drop whatever check holds the mode column alone (missed_guesses_mode_check, as Postgres named it), then
-- add the wider one under the same name.
do $$
declare
  c record;
begin
  for c in
    select con.conname as name
    from pg_catalog.pg_constraint con
    join pg_catalog.pg_class rel on rel.oid = con.conrelid
    join pg_catalog.pg_namespace nsp on nsp.oid = rel.relnamespace
    join pg_catalog.pg_attribute att on att.attrelid = rel.oid and con.conkey = array[att.attnum]
    where nsp.nspname = 'public' and rel.relname = 'missed_guesses' and con.contype = 'c' and att.attname = 'mode'
  loop
    execute pg_catalog.format('alter table public.missed_guesses drop constraint %I', c.name);
  end loop;
end;
$$;

alter table public.missed_guesses add constraint missed_guesses_mode_check check (mode in ('list', 'blitz', 'fathom'));

comment on table public.missed_guesses is 'Guesses the game didn''t take (unknown or junk), as normalized text: on a list, a Blitz round, or a Fathom name-it round (mode fathom, the question id in list_id). Linked to nobody: client_id is a random id kept for this alone. Read only through list_misses, with the reader key.';

-- A guess the game didn't take, on a list or a Blitz round, or a name on a Fathom name-it round (mode fathom, the
-- question's id as the list id). Checks and normalizes the way the game does before sending (src/net/misses.ts). True
-- when kept; false for a text this browser already sent on this list (or question) in this mode, or a browser sending
-- implausibly many (ignored); raises for anything malformed, or text that looks like an email address, a phone number
-- or a link.
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
  if p_mode is null or p_mode not in ('list', 'blitz', 'fathom') then
    raise exception 'submit_miss: mode must be list, blitz or fathom' using errcode = '22023';
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

-- The same grants as before (create or replace keeps them; stated again so the file stands alone).
revoke all on function public.submit_miss(text, text, text, text, uuid) from public;
grant execute on function public.submit_miss(text, text, text, text, uuid) to anon, authenticated;
