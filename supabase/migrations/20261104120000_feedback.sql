-- Notes: "add a note" under "Good list?" on the results of a list game or a Blitz round, a few words for the
-- improvement loop (docs/IMPROVE.md, step 0).
--
-- Append-only: a player may send more than one note on a list. Each keeps the player's rating of the list at the time
-- (1, -1, or null for none). Anonymous like ratings: client_id is the game's random per-browser id; user_id is set while
-- the player is signed in.
--
-- Notes are free text, so unlike plays and ratings nothing about them is readable with the public key. Players never
-- touch the table (row level security on, no policies, no grants): submit_feedback is the way in, and list_feedback
-- the way out, which answers only to the reader key. The key itself is never stored, only its SHA-256, in a schema the
-- API doesn't expose (private), set once with set_feedback_reader from the SQL editor. The owner's own notes come first:
-- public.owners lists the owner's account (added by hand, docs/BACKEND.md).
--
-- Account deletion (api/delete-account.ts, as service_role) deletes a player's linked notes, so service_role gets what
-- it needs here, as in the ratings migration.
--
-- Needs nothing from the earlier migrations (only Supabase's own roles and auth.users). Safe to run once.

create table public.feedback (
  id bigint generated always as identity primary key,
  list_id text not null check (list_id ~ '^[a-z0-9-]{1,64}$'),
  mode text not null check (mode in ('list', 'blitz')),
  -- The player's rating of the list when they wrote the note: 1, -1, or null (not rated).
  rating smallint check (rating in (-1, 1)),
  text text not null check (char_length(text) between 1 and 500),
  client_id uuid not null,
  user_id uuid references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index feedback_by_time on public.feedback (created_at desc);
create index feedback_by_client on public.feedback (client_id, created_at);
create index feedback_by_user on public.feedback (user_id) where user_id is not null;

alter table public.feedback enable row level security;
revoke all on table public.feedback from anon, authenticated;
grant select, delete on table public.feedback to service_role;

comment on table public.feedback is 'Notes on a list from its results. Free text: read only through list_feedback, with the reader key.';

-- The game's owner (or owners): their notes come first in list_feedback. Added by hand in the SQL editor.
create table public.owners (
  user_id uuid primary key references auth.users (id) on delete cascade
);

alter table public.owners enable row level security;
revoke all on table public.owners from anon, authenticated;

comment on table public.owners is 'The game''s owner(s), by account: their notes come first. Added in the SQL editor (docs/BACKEND.md).';

-- Private: a schema the Data API doesn't expose, and no role but its owner (and service_role, through the function
-- below) can touch.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.reader_keys (
  name text primary key check (name in ('feedback')),
  -- SHA-256 of the key, never the key itself.
  key_hash bytea not null check (octet_length(key_hash) = 32),
  set_at timestamptz not null default now()
);

revoke all on table private.reader_keys from public, anon, authenticated;

-- Send a note on a list in a mode. Checks the same things the game checks before sending (src/net/feedback.ts); the
-- text is trimmed here too. Returns false for a browser sending implausibly many notes (ignored); raises for anything
-- malformed. An exact repeat from the same browser within a day (a retry whose answer got lost) is kept once.
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
  if p_mode is null or p_mode not in ('list', 'blitz') then
    raise exception 'submit_feedback: mode must be list or blitz' using errcode = '22023';
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

-- Set (or change) the reader key: from the SQL editor, or with the secret key. Stores only its SHA-256.
create or replace function public.set_feedback_reader(p_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_key is null or char_length(p_key) < 24 then
    raise exception 'set_feedback_reader: use a long random key (24 characters or more)' using errcode = '22023';
  end if;
  insert into private.reader_keys (name, key_hash)
  values ('feedback', pg_catalog.sha256(pg_catalog.convert_to(p_key, 'UTF8')))
  on conflict (name) do update set key_hash = excluded.key_hash, set_at = now();
end;
$$;

-- Every note, for the improvement loop: only with the reader key (raises otherwise, also before a key is set). The
-- owner's notes first, then the newest first. p_since: only notes written since then. No ids.
create or replace function public.list_feedback(p_reader text, p_since timestamptz default null)
returns table (
  list_id text,
  mode text,
  rating smallint,
  text text,
  from_owner boolean,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_reader is null or not exists (
    select 1 from private.reader_keys k
    where k.name = 'feedback' and k.key_hash = pg_catalog.sha256(pg_catalog.convert_to(p_reader, 'UTF8'))
  ) then
    raise exception 'list_feedback: wrong reader key' using errcode = '42501';
  end if;
  return query
    select f.list_id, f.mode, f.rating, f.text, (o.user_id is not null), f.created_at
    from public.feedback f
    left join public.owners o on o.user_id = f.user_id
    where p_since is null or f.created_at >= p_since
    order by (o.user_id is not null) desc, f.created_at desc, f.id desc;
end;
$$;

revoke all on function public.submit_feedback(text, text, integer, text, uuid) from public;
revoke all on function public.list_feedback(text, timestamptz) from public;
revoke all on function public.set_feedback_reader(text) from public, anon, authenticated;
grant execute on function public.submit_feedback(text, text, integer, text, uuid) to anon, authenticated;
grant execute on function public.list_feedback(text, timestamptz) to anon, authenticated;
grant execute on function public.set_feedback_reader(text) to service_role;
