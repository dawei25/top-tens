-- Phase 2: accounts and save sync.
--
-- One row per signed-in player: their save, the same JSON the game keeps in the browser (localStorage
-- "top-tens:v1"), so it follows them across devices. The game merges its copy with this one and writes the result
-- back with a version check, so two devices never overwrite each other (src/net/sync).
--
-- Plays are linked to the account by submit_play (user_id = auth.uid()) while signed in. Deleting the sign-in
-- (auth.users) deletes the save and those plays with it.

create table public.saves (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  -- Bumped by every write (see saves_stamp); a write names the version it read, so a stale write changes nothing.
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  constraint saves_object check (jsonb_typeof(data) = 'object'),
  -- About what a browser can keep; real saves are far smaller.
  constraint saves_size check (octet_length(data::text) <= 5000000)
);

alter table public.saves enable row level security;

create policy "own save: read" on public.saves for select to authenticated using ((select auth.uid()) = user_id);
create policy "own save: add" on public.saves for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "own save: change" on public.saves for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own save: delete" on public.saves for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on table public.saves from anon, authenticated;
grant select, insert, update, delete on table public.saves to authenticated;

comment on table public.saves is 'Each signed-in player''s save, synced between their devices.';

-- The server, not the client, numbers the versions and stamps the time.
create or replace function public.saves_stamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.version := 1;
  else
    new.user_id := old.user_id;
    new.version := old.version + 1;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger saves_stamp before insert or update on public.saves
  for each row execute function public.saves_stamp();
