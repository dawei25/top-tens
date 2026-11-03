# Backend: score stats and accounts

TENtacle stays a static site. A backend is optional and off until you set two env vars; without them the game sends
nothing, stores nothing beyond the browser, and never downloads the backend code.

## How it fits together

- **Supabase** (Postgres + Auth, free plan) holds two tables: `plays` (one row per finished game, anonymous) and
  `saves` (one row per signed-in player: their save). Schema and functions: `supabase/migrations/`.
- **The client** is `src/net/`. The screens only touch a tiny facade (`src/net/index.ts`); the real work and
  `@supabase/supabase-js` (pinned) live in `src/net/service.ts`, loaded with a dynamic `import()` only in a build with
  the env vars, and only when there's work: a finished game, a stats view, a stored session, a sign-in.
- **Phase 1, anonymous stats.** A finished list game or Blitz round goes into a localStorage outbox and is sent once
  to `submit_play` (a `security definer` function: players can't read or write `plays` directly). The function
  checks the payload and ignores duplicates. Offline, it waits and retries. Results read `list_stats` (cached 5 min):
  from 50 players on a list (`MIN_PLAYERS`, `src/net/crowd.ts`) the histogram and percentile are real ("top 12% of
  1,203 players") instead of "est.". Blitz results get a percentile line from 50 players. The knowledge page reads
  `list_averages` and compares your average with players' on lists with 50+ players. Each player counts once per list
  and mode (their first game), so replays and repeat visits don't tilt it.
- **Phase 2, accounts.** Sign in with Google or an emailed link (PKCE flow; the email also carries a code for opening
  on another device). The save syncs on sign-in, after every finished game and when the tab comes back (at most every
  30 s): read the account's copy, merge it with this device's (`src/net/sync/merge.ts`: nothing is lost, see its
  header), write the merge back only if the copy is still the version that was read, else merge again. Never
  overwrite. Plays sent while signed in are linked to the account. The first sign-in on a device takes that device's
  games along. Signing out syncs once more, then clears the device (the games are in the account), so the next person
  to sign in there doesn't inherit them; if that last sync can't happen (offline), the games stay and are set aside for
  their account if someone else signs in. "Reset all progress" while signed in resets the account too (`resetAt` in
  the save), instead of being merged back from other devices.
- **Account deletion** is `api/delete-account.ts`, a Vercel function: deleting a sign-in needs Supabase's service
  role key, which must stay on a server. The function asks Supabase Auth whether the caller's access token is valid,
  then deletes that user's plays, save and sign-in. Why not a Postgres function: `delete from auth.users` in a
  `security definer` function can work, but `auth` is Supabase's managed schema and the Admin API is the supported way
  to remove a user (it also cleans up sessions and identities).

What's personal: only in Phase 2, the email (plus name and picture with Google, as Google sends them) and the save.
`plays` holds a random per-browser id, never an IP address. The in-game `#privacy` page says this to players.

## Switch it on

1. **Create the Supabase project** at supabase.com: free plan, region nearest your players (Frankfurt for Europe,
   N. Virginia for the US east coast). Keep the database password somewhere safe. From Project Settings > API, note
   the **Project URL**, the **anon public** key and the **service_role** key (secret).
2. **Run the migrations**, in order. Easiest: SQL Editor > New query > paste
   `supabase/migrations/20261101000000_plays.sql` > Run; then the same with `20261101000100_accounts.sql`.
   Or with the CLI: `npx supabase init` (keeps the existing migrations folder), `npx supabase link --project-ref
   <ref>`, `npx supabase db push`. Phase 1 alone only needs the first file.
3. **Sign-in URLs**: Authentication > URL Configuration. Site URL: `https://<your-domain>`. Redirect URLs:
   `https://<your-domain>/**` and, for local testing, `http://localhost:5100/**` (or your dev port). Vercel preview
   deployments need their own pattern too, for example `https://*-<your-team>.vercel.app/**`.
4. **Email links**: Authentication > Sign In / Providers > Email is on by default. Then:
   - Authentication > Emails > Templates > Magic Link: add a line with the code, so a link requested on a laptop
     can be finished on a phone: `<p>Or type this code in the game: {{ .Token }}</p>`.
   - Custom SMTP (Authentication > Emails > SMTP Settings): **needed for real players.** The built-in sender only
     delivers to your own team's addresses, at a couple of emails an hour; it's for testing. Any SMTP provider works
     (Resend, Brevo, Postmark, ...; most have a free tier). Then raise the email rate limit under Authentication >
     Rate Limits if needed.
5. **Google**:
   - Google Cloud Console > APIs & Services > OAuth consent screen: External, app name TENtacle, your support email,
     scopes `openid`, `email`, `profile`. Publish it (in testing mode only listed test users can sign in).
   - Credentials > Create credentials > OAuth client ID > Web application. Authorized JavaScript origins:
     `https://<your-domain>` and `http://localhost:5100`. Authorized redirect URI:
     `https://<project-ref>.supabase.co/auth/v1/callback` (Supabase's callback, not the game's URL).
   - Copy the client ID and secret into Supabase: Authentication > Sign In / Providers > Google > enable.
6. **Env vars in Vercel** (Project > Settings > Environment Variables, for Production and Preview):
   - `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`: **public**. They're built into the JavaScript, which is what
     they're for; row level security and the functions decide what anyone can do with them.
   - `SUPABASE_SERVICE_ROLE_KEY`: **secret**, mark it Sensitive. Only `api/delete-account.ts` reads it. Never give it
     a `VITE_` prefix (that would ship it to browsers) and never commit it.
   - Optional: `VITE_SIGN_IN` (`google,email` by default; `email`, `google`, or `none` for stats without accounts),
     `VITE_PRIVACY_CONTACT` (an address shown on the privacy page; worth setting).
   - `.env.example` lists them all. Locally, copy it to `.env.local` (gitignored).
7. **Redeploy** (Deployments > Redeploy, or push a commit). `VITE_` vars are read at build time, so an existing
   deployment doesn't pick them up.
8. **Check it works:**
   - Finish a list game on the site. Supabase > Table Editor > `plays` shows a row (or in the SQL editor:
     `select * from plays order by created_at desc limit 5;`). The browser's network tab shows
     `rpc/submit_play` answering `true`.
   - `select list_stats('mountains', 'list');` returns `{"n": ..., "counts": [...]}`. The results keep saying "est."
     until 50 players have finished that list.
   - A "Sign in" key appears in Home's Your games. Sign in with Google, then with an email link in another browser.
     `saves` gets a row; play on one device, focus the other, and the game shows up there.
   - Your knowledge > Account > delete account: the `saves` row and the user (Authentication > Users) are gone.
   - A build without the env vars (`npx vite --port 5100` with no `.env.local`) makes no requests to Supabase and
     shows no Sign in key.

To ship Phase 1 first, set `VITE_SIGN_IN=none`: steps 3 to 5 and the service role key can wait.

## Costs and limits

Figures as of late 2026, from secondary sources (supabase.com wasn't reachable when this was written): check
supabase.com/pricing and vercel.com/pricing.

- **Supabase Free**: about 500 MB of database per project, 50,000 monthly active users for Auth, two active free
  projects, a few GB of egress. A free project **pauses after a week without traffic**: the game then quietly falls
  back to its estimates and local saves until you restore it in the dashboard (Pro, $25/month, never pauses).
- **Space**: a play row is about 200 bytes with its indexes, so a million games is around 200 MB. A save is a few to a
  few hundred KB (stored compressed). Watch Database size under Reports.
- **Email**: the built-in sender is test-only (see step 4); custom SMTP providers' free tiers cover a small game.
- **Vercel Hobby** is free but for **personal, non-commercial use only**. Ads, sponsorship or paid features mean the
  Pro plan. The one function (account deletion) runs rarely.
- Google sign-in is free.

## Running it

- **Tuning**: `MIN_PLAYERS` (50) in `src/net/crowd.ts`; Blitz buckets are 50 points (`list_stats`); stats cache
  5 min, averages 10 min (`src/net/service.ts`).
- **Par** still comes from `public/puzzles/par.json` (the title card shows it during play). Once lists have real
  players, par.json could be regenerated from `list_stats` medians.
- **Abuse**: anyone can call `submit_play` with the public key. It checks shapes and ranges, counts each player once
  per list, and ignores a browser past 120 games an hour, but a determined script with fresh ids can still skew a
  quiet list. If that happens, find the ids (`select client_id, count(*) from plays group by 1 order by 2 desc`) and
  delete their rows.
- **Local development**: `.env.local` with the URL and anon key, `npx vite --port 5100`, and that URL in Supabase's
  Redirect URLs. `/api/delete-account` only runs on Vercel (`npx vercel dev` locally).
- **Tests**: `npm test` covers the client (`src/net/*.test.ts`), the merge and the database functions
  (`supabase/migrations.test.ts`, in PGlite). `npm run e2e` runs the browser suite with no backend, plus
  `e2e/backend.e2e.cjs`, which builds a copy with fake env vars and mocks Supabase.
