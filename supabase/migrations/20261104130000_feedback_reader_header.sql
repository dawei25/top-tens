-- list_feedback also takes the reader key from an X-Feedback-Reader request header.
--
-- The improvement loop runs in a cloud environment whose proxy adds a stored secret to requests as a header, so the
-- agent never sees the key itself. PostgREST hands the request's headers to the function as request.headers (JSON,
-- names lowercased). A key given in p_reader still wins; an empty or missing p_reader falls back to the header.
--
-- Run after 20261104120000_feedback.sql. Same signature and grants, so it is safe to run once or again.

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

revoke all on function public.list_feedback(text, timestamptz) from public;
grant execute on function public.list_feedback(text, timestamptz) to anon, authenticated;
