-- Account deletion: what the server needs.
--
-- api/delete-account.ts (a Vercel function, with the secret key, so as service_role) deletes a player's linked games
-- and save before their sign-in. Projects that hand every new table to the API roles already allow that; projects
-- created with "Automatically expose new tables" off don't, so it's granted here. Players get nothing new: anon and
-- authenticated keep exactly what the earlier migrations gave them.
--
-- Safe to run more than once, and on projects that already had these grants.

grant select, delete on table public.plays to service_role;
grant select, delete on table public.saves to service_role;
