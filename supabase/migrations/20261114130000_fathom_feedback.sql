-- Fathom feedback: "Good question?" and "add a note" on a Fathom question, with the same mechanics and tables as a
-- list's or a Blitz round's (the owner, Nov 14: "add the same feedback system for fathom that we currently have for
-- lists/blitz- ideally we keep the same mechanics and tables").
--
-- A Fathom rating or note is a row in ratings or feedback with mode 'fathom' and the question's id as list_id (a
-- question id has a list id's shape: public/fathom/questions.json, kebab-case, at most 64 characters). Everything else
-- is as for lists: one rating per browser (and per account) per question, the same reasons after a thumbs down (too
-- hard, too easy, boring, unfair, wrong data), the same hourly limits (shared with lists and Blitz), notes append-only
-- with the rating at the time. list_ratings and list_feedback need no change: they total and list by list_id and mode
-- as stored, so Fathom's rows come out under mode 'fathom', and list_feedback still answers only to the reader key.
-- Account deletion (api/delete-account.ts) already deletes a player's ratings and notes whatever their mode.
--
-- What changes: the mode checks on both tables and in rate_list and submit_feedback (same signatures, same grants).
--
-- Needs 20261103120000_ratings.sql and 20261104120000_feedback.sql (and nothing after them). Safe to run once, and
-- again: the checks are dropped and added back, the functions replaced.

-- The tables: drop whatever check holds the mode column alone (ratings_mode_check and feedback_mode_check, as
-- Postgres named them), then add the wider one under the same name.
do $$
declare
  c record;
begin
  for c in
    select rel.relname as tbl, con.conname as name
    from pg_catalog.pg_constraint con
    join pg_catalog.pg_class rel on rel.oid = con.conrelid
    join pg_catalog.pg_namespace nsp on nsp.oid = rel.relnamespace
    join pg_catalog.pg_attribute att on att.attrelid = rel.oid and con.conkey = array[att.attnum]
    where nsp.nspname = 'public' and rel.relname in ('ratings', 'feedback') and con.contype = 'c' and att.attname = 'mode'
  loop
    execute pg_catalog.format('alter table public.%I drop constraint %I', c.tbl, c.name);
  end loop;
end;
$$;

alter table public.ratings add constraint ratings_mode_check check (mode in ('list', 'blitz', 'fathom'));
alter table public.feedback add constraint feedback_mode_check check (mode in ('list', 'blitz', 'fathom'));

comment on table public.ratings is 'Thumbs up or down on a list (or a Fathom question, mode fathom), one per player, list and mode. Anonymous: client_id is a random per-browser id.';
comment on table public.feedback is 'Notes on a list (or a Fathom question, mode fathom) from its results. Free text: read only through list_feedback, with the reader key.';

-- Rate a list in a mode (list, blitz, or fathom with a question id): 1 (good), -1 (not), or 0 to take a rating back. A
-- reason only goes with -1. Checks the same things the game checks before sending (src/net/ratings.ts). Returns false
-- for a browser sending implausibly many ratings (ignored); raises for anything malformed.
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
  if p_mode is null or p_mode not in ('list', 'blitz', 'fathom') then
    raise exception 'rate_list: mode must be list, blitz or fathom' using errcode = '22023';
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

-- Send a note on a list in a mode (list, blitz, or fathom with a question id). Checks the same things the game checks
-- before sending (src/net/feedback.ts); the text is trimmed here too. Returns false for a browser sending implausibly
-- many notes (ignored); raises for anything malformed. An exact repeat from the same browser within a day (a retry
-- whose answer got lost) is kept once.
create or replace function public.submit_feedback(
  p_list_id text,
  p_mode text,
  p_rating integer,
  p_text text,
  p_client_id uuid
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  body text := pg_catalog.regexp_replace(p_text, '^[[:space:]]+|[[:space:]]+$', '', 'g');
begin
  if p_list_id is null or p_list_id !~ '^[a-z0-9-]{1,64}$' then
    raise exception 'submit_feedback: bad list id' using errcode = '22023';
  end if;
  if p_mode is null or p_mode not in ('list', 'blitz', 'fathom') then
    raise exception 'submit_feedback: mode must be list, blitz or fathom' using errcode = '22023';
  end if;
  if p_rating is not null and p_rating not in (-1, 1) then
    raise exception 'submit_feedback: rating must be 1, -1 or null' using errcode = '22023';
  end if;
  if body is null or char_length(body) < 1 or char_length(body) > 500 then
    raise exception 'submit_feedback: a note is 1 to 500 characters' using errcode = '22023';
  end if;
  if p_client_id is null then
    raise exception 'submit_feedback: client id missing' using errcode = '22023';
  end if;

  -- Nobody writes 20 notes an hour: past that, a browser is looping or scripted, and its notes are ignored.
  if (select count(*) from public.feedback f where f.client_id = p_client_id and f.created_at > now() - interval '1 hour') >= 20 then
    return false;
  end if;

  if exists (
    select 1 from public.feedback f
    where f.client_id = p_client_id and f.list_id = p_list_id and f.mode = p_mode and f.text = body
      and f.created_at > now() - interval '1 day'
  ) then
    return true;
  end if;

  insert into public.feedback (list_id, mode, rating, text, client_id, user_id)
  values (p_list_id, p_mode, p_rating, body, p_client_id, uid);
  return true;
end;
$$;

-- The same grants as before (create or replace keeps them; stated again so the file stands alone).
revoke all on function public.rate_list(text, text, integer, text, uuid) from public;
revoke all on function public.submit_feedback(text, text, integer, text, uuid) from public;
grant execute on function public.rate_list(text, text, integer, text, uuid) to anon, authenticated;
grant execute on function public.submit_feedback(text, text, integer, text, uuid) to anon, authenticated;
