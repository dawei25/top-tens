# Backend: score stats, list ratings, notes and accounts

TENtacle stays a static site. A backend is optional and off until you set two env vars; without them the game sends
nothing, stores nothing beyond the browser, and never downloads the backend code (`e2e/backend.e2e.cjs` checks it).

## How it fits together

- **Supabase** (Postgres + Auth, free plan) holds five tables: `plays` (one row per finished game, anonymous),
  `ratings` (a thumbs up or down per player, list and mode, anonymous), `feedback` (notes on lists, free text, read
  only with a private key), `fathom_guesses` (the Fathom beta's guesses, one per browser and question, anonymous) and
  `saves` (one row per signed-in player: their save), plus `owners` (the owner's account, so his notes come first).
  Schema and functions: `supabase/migrations/`.
- **The client** is `src/net/`. The screens only touch a tiny facade (`src/net/index.ts`); the real work and
  `@supabase/supabase-js` (pinned) live in `src/net/service.ts`, loaded with a dynamic `import()` only in a build with
  the env vars, and only when there's work: a finished game, a stats view, a stored session, a sign-in.
- **Score stats.** A finished list game or Blitz round goes into a localStorage outbox and is sent once to
  `submit_play` (a `security definer` function: players can't read or write `plays` directly). The function checks
  the payload and ignores duplicates. Offline, it waits and retries. Results read `list_stats` (cached 5 min) and
  blend real players into the estimate from `public/puzzles/par.json` (How the averages blend, below): "PLAYERS AVG
  6", the histogram, "better than 19% of players (estimated)" while the estimate outweighs them, then "better than 12%
  of 1,203 players". Blitz has no estimate: its results get a line like that from 30 players. Stats adds "Vs players"
  (`list_averages`, real players alone) for lists with 50+ players (`MIN_PLAYERS`). Each player counts once per list
  and mode (their first game), like the game's own stats (first tries only), and the owner's testers not at all.
- **List ratings.** The results of a list game or Blitz round (and their runs in Past runs) end with "Good list?" and
  a thumbs up and down; after a thumbs down, one optional reason from a fixed set (too hard, too easy, boring,
  answers felt unfair, wrong data: `RATING_REASONS`, `src/net/ratings.ts`). The rating goes into the save first
  (`ratings`, `${mode}:${listId}` -> `{ rating, reason?, at }`), so it shows as chosen later, offline and in a build
  without a backend, and syncs (the latest `at` wins; a rating taken back is kept as 0, so that wins too). With a
  backend it also goes into its own outbox (`top-tens:rating-outbox`, only the latest per list and mode waits) and to
  `rate_list`, retried like plays. The table keeps one row per browser, list and mode (the latest replaces the
  earlier one; 0 deletes it), linked to the account while signed in, and then one per player across devices.
  `list_ratings` gives the totals per list and mode, for the improvement loop (see Running it).
- **Notes.** Under "Good list?", in a build with a backend only, "add a note" opens a box in place: up to 500
  characters, sent with SEND (or Ctrl/Cmd+Enter) together with the player's rating of the list at that moment, then
  "sent. thanks." in the key's place. Without a backend the key isn't there at all (nowhere to send a note). A note is
  queued at once in its own outbox (`top-tens:feedback-outbox`, every note waits, oldest first) by the always-loaded
  facade, so it survives the backend code failing to download offline, then goes to `submit_feedback`, retried like
  plays. Notes never go in the save and don't sync. The table is append-only (a player may send several), linked to
  the account while signed in, and nothing in it is readable with the public key: `list_feedback` answers only to the
  reader key, whose SHA-256 (never the key) sits in a schema the Data API doesn't expose (`private.reader_keys`). The
  owner's own notes come first (`owners`). See Switch it on (2.5) and Running it.
- **Fathom guesses** (the estimation beta, `#fathom`). Each locked-in guess is queued at once by the facade in its own
  outbox (`top-tens:fathom-outbox`, one per question: a question drawn again in a later game adds nothing) and sent to
  `submit_fathom_guess` (the question id, the number, the random id; linked to the account while signed in), retried
  like plays. The table keeps a browser's first guess on each question. The reveal asks `fathom_compare` (the
  question, the guess, the answer it shows, since the questions live in the static site, and the random id; cached 5
  min): how many players, their median guess, and the share further off than this guess (on the game's scale, how
  many times off), one guess per player (their first), leaving out the owners, `stats_excluded` and the player asking.
  From 20 players on a question (`MIN_PLAYERS`, `src/game/fathom.ts`) it says "Players' typical guess: 4 litres · you
  were closer than 72%"; below that, nothing. Never in the save, never synced. See Switch it on (2.8).
- **Accounts.** Sign-in methods come from `VITE_SIGN_IN`: Google, an email and password (`password`: nothing is
  emailed), or a link by email (`email`, PKCE; the email also carries a code for another device). Google is our own
  key (our keycap, Google's G, "Continue with Google"). With `VITE_GOOGLE_CLIENT_ID` set (`src/net/google.ts`), it
  opens Google's OpenID Connect endpoint (`https://accounts.google.com/o/oauth2/v2/auth`, `response_type=id_token`)
  in a popup, with this site's `auth/google.html` as the redirect URI; Google sends the popup there with an ID token in
  the address's fragment, that page (`src/net/google-callback.ts`) posts it to the game window (same origin only) and
  closes, the game checks the `state` it asked with, and `signInWithIdToken` trades the token for a Supabase session.
  Google gets the SHA-256 of a fresh nonce, Supabase the nonce itself, so a token can't be replayed. A blocked popup
  takes the whole tab to Google and back to `auth/google.html`, which returns to the game on the screen the player
  left, and the game finishes the sign-in as it starts; a popup that has no way back to the game window (some in-app
  browsers) does the same in its own window. Nothing is loaded from Google before the press. Without the variable,
  the key goes through Supabase's redirect (`signInWithOAuth`). The save syncs
  on sign-in, after every finished game and when the tab comes back (at most every 30 s): read the account's copy,
  merge it with this device's (`src/net/sync/merge.ts`: nothing is lost, see its header), write the merge back only if
  the copy is still the version that was read, else merge again. Never overwrite. Plays sent while signed in are
  linked to the account. The first sign-in on a device takes that device's games along. Signing out syncs once more,
  then clears the device (the games are in the account); if that sync can't happen (offline), the games stay and are
  set aside for their account if someone else signs in. "Reset all progress" while signed in resets the account too.
- **Account deletion** is `api/delete-account.ts`, a Vercel function: deleting a sign-in needs the secret key, which
  must stay on a server. It asks Supabase Auth whether the caller's access token is valid, then deletes that user's
  notes, ratings, plays, save and sign-in (Auth's Admin API, the supported way to remove a user); their linked Fathom
  guesses go with the sign-in (`on delete cascade`). A project without the ratings or feedback table yet is fine
  (there's nothing to delete); any other failure stops before the sign-in goes.

What's personal: only with an account, the email (plus name and picture with Google; a password only as Supabase's
hash) and the save. `plays`, `ratings`, `feedback` and `fathom_guesses` hold a random per-browser id, never an IP
address. A note is
whatever the player typed, so only the owner reads notes, and the privacy page asks players to leave personal details
out. Nothing comes from Google until the player presses Continue with Google. The in-game `#privacy` page says this.

## How the averages blend

A list's estimate (`par.json`, a synthetic crowd from the list judges' simulated players) counts as **W = 30 virtual
players** (`ESTIMATE_WEIGHT`, `src/net/crowd.ts`), and every real player's first try joins them; nothing switches at
a player count. The histogram and "better than X%" use W x the estimate's share of each score plus the real counts;
the average is (W x the estimate's figure + n x the real mean) / (W + n), so a list nobody has played reads exactly as
before, 30 real players weigh as much as the estimate, and 300 make it about 91% real. While n < W the line says
"(estimated)"; from W it names the players ("of 1,203 players"). Blitz has no estimate, so its line waits for W real
players. The owner and the accounts in `stats_excluded` (testers, friends: step 2.7) are left out of `list_stats` and
`list_averages`, with the games their browsers sent signed out, so the people who built the lists don't set the
first numbers. Planned at about 200 players a list: adjust for each player's strength (a player who aces every list
says less about this one), so a few strong regulars can't lift every average.

## Switch it on

1. **Create the Supabase project** at supabase.com: free plan, region nearest your players. "Automatically expose
   new tables" off and automatic RLS on are the right choices: the migrations turn RLS on and grant exactly what the
   game uses. Project Settings > API Keys: note the **Project URL**, the **publishable key** (`sb_publishable_...`)
   and a **secret key** (`sb_secret_...`). Legacy anon and service_role keys work too, until Supabase retires them
   (end of 2026).
2. **Run the migrations**, in order: SQL Editor > New query > paste the file > Run.
   1. `supabase/migrations/20261101000000_plays.sql` (score stats)
   2. `supabase/migrations/20261101000100_accounts.sql` (saves)
   3. `supabase/migrations/20261103000000_deletion_grants.sql` (lets account deletion clear a player's rows; safe to
      run twice)
   4. `supabase/migrations/20261103120000_ratings.sql` (list ratings: the `ratings` table, `rate_list`,
      `list_ratings`, and the grant account deletion needs; run once). Run it before deploying the game that rates:
      until it has run, `rate_list` answers 404 and the game drops those ratings (they stay in the players' saves;
      nothing breaks).
   5. `supabase/migrations/20261104120000_feedback.sql` (notes: the `feedback` and `owners` tables, the `private`
      schema with `reader_keys`, `submit_feedback`, `list_feedback`, `set_feedback_reader`, and the grant account
      deletion needs; run once). Run it before deploying the game with "add a note": until it has run,
      `submit_feedback` answers 404 and the game drops those notes. Then, once, in the SQL Editor:
      - **Make yourself the owner**, so your notes come first. Sign in to the game once (so your account exists),
        then run, with your account's address in place of the placeholder:

        ```sql
        insert into public.owners (user_id) select id from auth.users where email = '<your email>';
        ```

        Check it took: `select count(*) from public.owners;` says 1 (0 means no account has that address yet). Notes
        count as yours when you send them signed in; after step 7 your games stay out of the players' numbers too. To
        add someone else later, the same line with their address;
        `delete from public.owners where user_id = ...` removes one.
      - **Set the reader key**, the secret the improvement loop reads notes with. Make a long random one on your
        machine (`openssl rand -hex 32`: hex is safe in JSON and in a shell), keep it in your password manager, and
        run:

        ```sql
        select set_feedback_reader('<a long random string>');
        ```

        Only its SHA-256 is stored, so it can't be read back: lose it and you set a new one the same way (the old one
        stops working). It takes 24 characters or more. Only the SQL Editor (or the secret key) can set it; the
        public key can't. Don't save that query as a snippet (it holds the key). Give the loop the same key as a
        network secret of its cloud environment (Running it), so the agent never sees it. Never commit it, never
        give it a `VITE_` prefix: the game itself never reads notes.
   6. `supabase/migrations/20261104130000_feedback_reader_header.sql` (run once, after 5): `list_feedback` also takes
      the reader key from an `X-Feedback-Reader` header, which is how the cloud environment's proxy hands it over.
   7. `supabase/migrations/20261105120000_stats_exclusions.sql` (after 4 and 5; safe to run again): testers out of the
      public numbers. Adds the `stats_excluded` table (players can't read or touch it) and replaces `list_stats` and
      `list_averages` with versions that leave out first tries by the owners (step 5) and by `stats_excluded`: their
      accounts' games, and the games sent signed out from any browser they've used signed in (someone else signed in
      there still counts). Same functions and answers, so the game works the same before and after it runs. Then, for
      each tester or friend whose games shouldn't count (they sign in to the game once first, so the account exists):

      ```sql
      insert into public.stats_excluded (user_id) select id from auth.users where email = '<their email>';
      ```

      Check it took: `select count(*) from public.stats_excluded;` went up by 1. It counts from the next stats read
      (the game caches them 5 min). `delete from public.stats_excluded where user_id = (select id from auth.users where
      email = '<their email>');` counts them again; deleting their account removes the row too (and with it the
      browser link, so games they sent signed out count again). Games sent signed out from a browser never used
      signed in can't be told apart from anyone else's.
   8. `supabase/migrations/20261105130000_fathom_guesses.sql` (after 7; run once): the Fathom beta's guesses. Adds the
      `fathom_guesses` table (players can't read or touch it), `submit_fathom_guess` and `fathom_compare`, which
      leaves out the owners and `stats_excluded` like the score stats. The game works before it runs: until then
      `submit_fathom_guess` answers 404 and the game drops those guesses, and reveals show no players' line, as they
      don't anyway below 20 players on a question. Check it took: lock in a guess on `#fathom`; Table Editor >
      `fathom_guesses` has a row, and `select fathom_compare('eiffel-tower-height', 300, 330);` returns
      `{"n": ..., "median": ..., "further_off": ...}`.

   Or with the CLI: `npx supabase link --project-ref <ref>`, `npx supabase db push` (the one-time steps above still go
   in the SQL Editor). Stats alone only need the first.
3. **Sign-in URLs**: Authentication > URL Configuration. Site URL: `https://<your-domain>`. Redirect URLs:
   `https://<your-domain>/**`, and for local testing `http://localhost:5100/**`. Vercel previews need their own
   pattern, for example `https://*-<your-team>.vercel.app/**`.
4. **Sign-in methods** (`VITE_SIGN_IN`, step 6). For each one you list:
   - `password`: Authentication > Sign In / Providers > Email: on, and **turn off "Confirm email"**, so a new account
     is signed in at once and no email is ever sent. (Left on, the game says "check your email to confirm", and
     you'd need custom SMTP: see `email`.) The game asks for 6+ characters, Supabase's default; a stricter rule set
     under Email is shown to players in its own words. There's no password reset: the sign-in sheet says "forgot your
     password? ask us at <VITE_PRIVACY_CONTACT>" (nothing without a contact). To help someone, set a new password
     with the Admin API from a trusted machine (`auth.admin.updateUserById(id, { password })`, secret key), or delete
     the user in Authentication > Users (their save goes too).
   - `google`, in Google Cloud Console > Google Auth Platform:
     - **Branding**: app name TENtacle, support email; under Authorized domains, your domain and `<ref>.supabase.co`.
     - **Audience**: User type External, then **Publish app** (in Testing only listed test users can sign in).
     - **Data Access**: `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile`. Nothing else; these need no
       review by Google.
     - **Clients** > Create client > **Web application**. Authorized JavaScript origins: `https://<your-domain>` and
       `http://localhost:5100` (Google asks browser sign-ins to come from these). Authorized redirect URIs, each
       exactly as written (scheme, path and `.html` included; Google compares them character for character):
       - `https://<your-domain>/auth/google.html`: the game's own callback page. For the live game:
         `https://toptentacle.vercel.app/auth/google.html`.
       - `http://localhost:5100/auth/google.html`: the same, for local testing (any other local port needs its own).
       - `https://<ref>.supabase.co/auth/v1/callback`: Supabase's callback, for builds without `VITE_GOOGLE_CLIENT_ID`
         (previews).

       Until the first one is there, pressing Continue with Google on the live game ends at Google's "Error 400:
       redirect_uri_mismatch".
     - Copy the client ID and secret into Supabase: Authentication > Sign In / Providers > Google > enable. The
       **Client IDs** field must list this web client ID (Supabase checks the ID token's audience against it; it's
       the same client the redirect uses, so it already does). Leave **Skip nonce checks** off: the game sends a
       nonce.
     - Then set `VITE_GOOGLE_CLIENT_ID` (step 6) to the same client ID.
     - **What players see.** Google's account chooser names the site its answer goes to (the redirect URI's
       domain). With `VITE_GOOGLE_CLIENT_ID` set, that's the game's own callback page, so it says "to continue to
       <your-domain>" (toptentacle.vercel.app) and Google never sees the Supabase domain. Without it, the redirect
       goes through Supabase's callback and the chooser names `<ref>.supabase.co`. Google shows the app name
       "TENtacle" (and logo) instead of a domain only once the brand is verified: Branding > Verify branding (needs
       the homepage and privacy policy links on a domain you've verified in Search Console). If verification objects
       to `<ref>.supabase.co` (a domain you can't verify), removing it and the Supabase redirect URI leaves the game's
       Google sign-in working but ends the Supabase fallback (previews).
   - `email` (a link): Authentication > Emails > Templates > Magic Link: add `<p>Or type this code in the game:
     {{ .Token }}</p>`. Custom SMTP (Authentication > Emails > SMTP Settings) is **needed for real players**: the
     built-in sender only delivers to your team's addresses, a couple an hour.
5. **Data API**: nothing to expose by hand. The game calls eight functions (`submit_play`, `list_stats`,
   `list_averages`, `rate_list`, `list_ratings`, `submit_feedback`, `submit_fathom_guess`, `fathom_compare`) and reads
   and writes only its own `saves` row; the migrations grant exactly that (`ratings`, `feedback`, `fathom_guesses`,
   `owners` and `stats_excluded`, like `plays`, have no grants for players at all, and the `private` schema isn't in
   the API's exposed schemas: leave it out). `list_feedback` is
   for the loop and refuses anyone without the reader key.
6. **Env vars in Vercel** (Project > Settings > Environment Variables, Production and Preview):
   - `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` = the publishable key (`VITE_SUPABASE_PUBLISHABLE_KEY` works
     too). **Public**: built into the JavaScript, which is what they're for; RLS and the functions decide what anyone
     can do with them.
   - `SUPABASE_SERVICE_ROLE_KEY` = the secret key (`SUPABASE_SECRET_KEY` works too). **Secret**: mark it Sensitive.
     Only `api/delete-account.ts` reads it. Never give it a `VITE_` prefix, never commit it.
   - `VITE_SIGN_IN`: for example `google,password`. Default `google,email`; `none` for stats without accounts.
     Unknown names are ignored.
   - `VITE_GOOGLE_CLIENT_ID`: the Google OAuth web client ID (`...apps.googleusercontent.com`, Google Auth Platform
     > Clients; not the secret). **Public**, like the Supabase key. With it, Google sign-in goes from the game to
     Google and back to the game's `auth/google.html`, and the account chooser names the game's domain; without it,
     the redirect through Supabase. A value that isn't a client ID is ignored (the Supabase redirect stays).
     **Production only**: Authorized redirect URIs and JavaScript origins take no wildcards, so preview URLs keep the
     Supabase redirect.
   - Pasted values are trimmed: a trailing newline or space doesn't matter.
   - `VITE_PRIVACY_CONTACT`: an address for privacy questions and forgotten passwords. Worth setting.
   - `.env.example` lists them all. Locally, copy it to `.env.local` (gitignored).
7. **Redeploy** (Deployments > Redeploy, or push a commit): `VITE_` vars are read at build time.
8. **Check it works:**
   - Finish a list game. Table Editor > `plays` shows a row; the browser's network tab shows `rpc/submit_play`
     answering `true`. `select list_stats('mountains', 'list');` returns `{"n": ..., "counts": [...]}`.
   - Home's account key (the pixel player left of the sound key) is hollow, named "Account: not signed in"; it opens
     the sign-in sheet ("new here? create an account" inside). Create an account with a password in one browser, sign
     in with Google in another: the key lights up cyan. `saves` gets a row; play on one, focus the other, and the game
     shows up there. Offline, the key gets a pink dot and its sheet says offline.
   - Google: Continue with Google opens a Google window whose account chooser names your domain, not
     `<ref>.supabase.co`; after choosing, the window closes itself and the network tab shows
     `token?grant_type=id_token` answering 200. "Error 400: redirect_uri_mismatch" in Google's window means the
     client lacks this exact Authorized redirect URI (`https://<your-domain>/auth/google.html`); `origin_mismatch`,
     the JavaScript origin. A 400 "Unacceptable audience" from Supabase means its Client IDs field lacks this client;
     "Nonces mismatch" or "Passed nonce and nonce in id_token should either both exist or not" means a stale build or
     a changed nonce setting. With pop-ups blocked, the whole tab goes to Google and comes back signed in.
   - Rate a list on its results: the network tab shows `rpc/rate_list` answering `true`, and
     `select * from list_ratings();` has a row for it.
   - Signed in, add a note on a list's results: the network tab shows `rpc/submit_feedback` answering `true`, and
     `select * from list_feedback('<your reader key>');` lists it first, `from_owner` true. With the public key and a
     wrong key, the curl in Running it answers 401 or 403 (`wrong reader key`), never notes.
   - Home > the account key > delete account: the `saves` row and the user (Authentication > Users) are gone.
   - A build without the env vars (`npx vite --port 5100`, no `.env.local`) makes no requests to Supabase and shows no
     account key.

To ship stats first, set `VITE_SIGN_IN=none`: steps 3 and 4 and the secret key can wait.

## Keys

supabase-js 2.118.0 knows both formats (`sb_publishable_`, `sb_secret_`) and treats them as Supabase documents:
always the `apikey` header; never a bearer token for Edge Functions (the game has none). Signed out, the client also
sends the publishable key as the bearer for the Data API, which the live project accepted on Nov 3 (`list_stats`,
read only). The deletion function sends the secret key as `apikey`, the player's own token to `auth.getUser`, then
deletes their rows and calls `auth.admin.deleteUser`; `src/net/delete-account.test.ts` pins down those requests.
Supabase refuses secret keys in requests from a browser, so the function is the only place it can live. The env var
names stay as they were; the new names are accepted too.

## Costs and limits

Figures as of late 2026, from secondary sources: check supabase.com/pricing and vercel.com/pricing.

- **Supabase Free**: about 500 MB of database, 50,000 monthly active users for Auth, two active free projects, a few
  GB of egress. A free project **pauses after a week without traffic**: the game then quietly falls back to its
  estimates and local saves until you restore it in the dashboard (Pro, $25/month, never pauses).
- **Space**: a play row is about 200 bytes with its indexes, so a million games is around 200 MB. A save is a few to
  a few hundred KB. Watch Database size under Reports.
- **Email**: none with `google,password` and Confirm email off. The `email` method needs custom SMTP (step 4).
- **Vercel Hobby** is free but for **personal, non-commercial use only**. Ads, sponsorship or paid features mean the
  Pro plan. The one function (account deletion) runs rarely.

## Running it

- **Tuning**: `ESTIMATE_WEIGHT` (W = 30, the blend) and `MIN_PLAYERS` (50, Stats' "Vs players") in
  `src/net/crowd.ts`; Blitz buckets are 50 points (`list_stats`); stats cache 5 min, averages 10 min
  (`src/net/service.ts`).
- **The average**: the results blend real players in per list (How the averages blend). Past runs and Stats' "vs avg"
  still compare with `public/puzzles/par.json` alone (players never see the word "par"); once lists have real
  players, par.json could be regenerated from `list_stats`. Testers: `stats_excluded` (step 2.7).
- **Ratings for the improvement loop**: `list_ratings(p_since timestamptz default null)` returns, per list and mode,
  `up`, `down`, the downs per reason (`too_hard`, `too_easy`, `boring`, `unfair`, `wrong_data`) and `last_rated`:
  totals only, no ids, each player counted once (their latest rating). `p_since` keeps only ratings given or changed
  since then. It's readable with the public key, so the loop needs no secret:

  ```bash
  curl -s "$VITE_SUPABASE_URL/rest/v1/rpc/list_ratings" -H "apikey: $VITE_SUPABASE_ANON_KEY" \
    -H "content-type: application/json" -d '{"p_since": "2026-11-01T00:00:00Z"}'
  ```

  In the SQL Editor: `select * from list_ratings() order by down - up desc;`.
- **Notes for the improvement loop**: `list_feedback(p_reader text, p_since timestamptz default null)` returns every
  note: `list_id`, `mode`, `rating` (the player's rating of the list when they wrote it: 1, -1 or null), `text`,
  `from_owner` and `created_at`, the owner's notes first, then the newest first; no ids. `p_since` keeps only notes
  written since then. It needs the reader key (2.5): without it, or with a wrong one, it raises (`wrong reader key`)
  and returns nothing, so the public key alone can't read a single note. The key comes either as `p_reader` or, when
  that is empty, in an `X-Feedback-Reader` header (migration 6). The loop's cloud environment holds it as a network
  secret (Add secret: allowed website `<ref>.supabase.co`, path prefix `/rest/v1/rpc/list_feedback`, custom header
  `X-Feedback-Reader` with no prefix), so its proxy adds the header and the agent never sees the key. The loop calls
  it with the public key and an empty `p_reader`:

  ```bash
  curl -s "$VITE_SUPABASE_URL/rest/v1/rpc/list_feedback" -H "apikey: $VITE_SUPABASE_ANON_KEY" \
    -H "authorization: Bearer $VITE_SUPABASE_ANON_KEY" -H "content-type: application/json" \
    -d '{"p_reader": "", "p_since": "2026-11-01T00:00:00Z"}'
  ```

  Elsewhere, pass the key as `p_reader` instead. In the SQL Editor: `select * from list_feedback('<your reader
  key>');`. A new key (`set_feedback_reader` again) replaces the old one at once; update the network secret with it.
- **Abuse**: anyone can call `submit_play` with the public key. It checks shapes and ranges, counts each player once
  per list, and ignores a browser past 120 games an hour, but a determined script with fresh ids can still skew a
  quiet list. If that happens, find the ids (`select client_id, count(*) from plays group by 1 order by 2 desc`) and
  delete their rows. `rate_list` is the same: shapes checked, one rating per browser (and per account) per list and
  mode, a browser past 120 rated lists an hour ignored; clean up the same way in `ratings`. `submit_feedback` checks
  the shape (1 to 500 characters after trimming), keeps an exact repeat from the same browser once, and ignores a
  browser past 20 notes an hour; spam is cleaned up the same way in `feedback`. Notes are never shown to players, so
  junk only costs the loop a read. `submit_fathom_guess` checks the shape (a question id, a number above 0 and under
  1e300), keeps a browser's first guess on each question, and ignores a browser past 120 guesses an hour; the median
  and the share resist a few wild guesses, and junk is cleaned up the same way in `fathom_guesses`.
- **Local development**: `.env.local` with the URL and publishable key, `npx vite --port 5100`, and that URL in
  Supabase's Redirect URLs. `/api/delete-account` only runs on Vercel (`npx vercel dev` locally). Google sign-in
  needs `http://localhost:5100` among the client's Authorized JavaScript origins and
  `http://localhost:5100/auth/google.html` among its Authorized redirect URIs (the dev server serves that page too).
- **Headers**: the site sends no Content-Security-Policy and no Cross-Origin-Opener-Policy, which is what the Google
  popup needs to hand its token back to the game window. If you add them: no COOP at all on `/auth/google.html` (any
  value there cuts the popup off from the game: it then signs in on its own and the game tab only follows through
  Supabase), at most `same-origin-allow-popups` on the game (plain `same-origin` cuts it off too). Nothing is loaded
  from Google, so CSP needs no Google sources; the callback page has one script file of its own (`script-src 'self'`)
  and a small inline style.
- **Tests**: `npm test` covers the client (`src/net/*.test.ts`), the merge and the database functions
  (`supabase/migrations.test.ts`, in PGlite, with and without new tables exposed, ratings, notes and Fathom guesses
  included: no player reads a note, a wrong reader key raises, the key by header, the owner's notes come first, the
  rate limits, deletion, the owners and `stats_excluded` left out of the stats and of `fathom_compare`, signed in or
  not; a browser's first guess kept, one per player, the asker left out, ties not further off). `src/net/crowd.test.ts` pins
  the blend (n = 0 is the estimate exactly, 30 weigh equally, 300 are ~91% real, no cliff, Blitz, a list without an
  estimate). `npm run e2e` runs the browser suite with no backend (`e2e/rate.e2e.cjs`: rating on the results, and no
  note option), plus `e2e/backend.e2e.cjs`, which builds a copy with fake env vars (`e2e/backend-env.cjs`, every
  sign-in method on) and mocks Supabase (blended results above and below 30 players, `rate_list` and
  `submit_feedback` included; Fathom's guesses sent once and waiting offline, the players' line with 37 players and
  none with 12), `e2e/note.e2e.cjs` on the same
  copy ("add a note": the exact arguments sent, offline waiting, Escape and Enter, the phone keyboard;
  `e2e/states.e2e.cjs` walks it too), and `e2e/backend-google.e2e.cjs`, a copy with a Google client ID against a fake
  Google endpoint (it answers with a redirect to the callback page, a token in the fragment): the exact request, the
  token and nonce reaching Supabase, the state check, a closed window, Cancel, a refused token, a blocked popup (the
  tab goes and comes back), a popup cut off from the game, and the key's states. `src/net/google.test.ts` and
  `google-callback.test.ts` cover the request, the callback page and the way back. Google's real chooser can only be
  tried on the real site.
