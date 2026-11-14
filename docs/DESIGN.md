# TENtacle: design

Formerly Top Tens. Name the top 10 of a ranked list. Five lives.

## 1. Rules

- 10 hidden slots, ordered by rank. A correct guess reveals its slot (rank, name, source value).
- 5 lives. **Only an accepted answer outside the top 10 costs a life**, and the game shows where it ranks and says so ("Tokyo is #11 with 200 skyscrapers. Lost a life.").
  On a regional geography list, a place outside the region also costs a life and says so ("Tokyo isn't in Europe.");
  places on two continents that the source leaves out are free (owner, Nov 3).
- Free (no life lost):
  - **Misspellings.** The input is corrected in place ("cambimia" becomes "Cambodia") and nothing is submitted until
    the player presses Enter again.
  - **Ambiguous typos** ("Irak"): tappable buttons fill the input with each option.
  - **Duplicates.**
  - **Anything that isn't an accepted answer** for the list: keyboard mash, or a real thing the source doesn't cover.
    A plain miss says how many of what the list holds ("Not one of the 258 countries here."), from the puzzle's
    `noun`, so a wrong kind of guess (cars on a list of countries) is obvious.
  - **A guess that fits several answers** ("jordan", "shenzhen", "avengers"): the natural reading goes in the box or
    the options are offered (see below); only a word shared by a crowd of minor names asks to be more specific.
- **Clue:** the magnifier on an empty row shows that answer's first letter for a life, after a confirm; not on the
  last life. Each further clue on the same row shows the next letter for another life ("SH", "LOS A": letters past a
  leading The/A/An, with the spaces and punctuation between them), for as long as the row is hidden (owner, Nov 5).
  Clues never change what a guess matches; every letter bought counts as a clue (results, Past runs, share text).
- Misses always show a number where the data has one: the rank and figure, a dated rank or figure from another
  table on the source page ("#5 in 2018 (18.6 million)"), or how deep the ranking goes ("outside the top 118").
- The game ends at 10/10 or 0 lives; missed slots are then revealed. A give up button reveals everything.

## 2. Answer matching (`src/game/match.ts`)

1. Normalize: lowercase, strip accents and punctuation, `&` → `and`, drop a leading article, Roman numerals → digits.
2. Exact match on name or alias submits immediately.
3. Otherwise fuzzy match (edit distance with transpositions, budget scaled by length; a slip in the middle of a 6-7
   letter word gets a third edit). A unique match fills the input. Generous, but never an unrelated word: past one
   slip a misspelling keeps its first letter ("factories" is not Castries); one word of a longer name only catches a
   near-exact typo ("pope" is not "Don't Bother Me, I Can't Cope"); a name with whole words added or dropped is not
   a typo ("neptune" is not Neptune I); a plain category word ("islands") is never corrected.
4. **The natural reading.** When several answers fit, read it the way a person means it: the most prominent first
   (the list's own ranking, then the wider pool). "jordan" puts Michael Jordan in the box to confirm, and DeAndre
   Jordan once MJ is found. Comparable ones are offered, up to four ("shenzhen", "china" on banks), names that are
   all called that are offered as equals ("carolina", "congo", "new zealand"), and an exact title that is the less
   likely reading offers the likelier one too ("avengers": Endgame or The Avengers). Part of a name ("american",
   "cars") asks before it counts or costs a life. Only a word shared by a crowd of minor names asks for more.
5. Numbers must agree: GTA 6 never matches GTA V.
6. A guess that is itself a known real name (any name in the bank, any country or capital) is never corrected into a
   different one: "Austria" is not Australia.
7. Unmatched input is free; `junk.ts` only picks the message ("doesn't look like an answer" vs "not a recognized
   answer").

## 3. Content

Puzzles are prebuilt from Wikipedia tables (`scripts/topics.ts`, `scripts/build.ts`) into `public/puzzles/*.json`,
with every table row as an accepted answer, aliases from redirects, and a source link with an "as of" date.
Modes: one daily, Today's list (from `public/puzzles/daily.json`), and free play (a random list or Blitz, optionally
by category). Blitz is free play only: Today's Blitz was retired (owner, Nov 9), and an old `#dailyblitz-<date>` link
opens that date's list as a free Blitz. **Dailies are one try each**, archive dailies included: a finished daily always reopens on
its result. Free play is endless (with an account; two games without one, §4): Roll new list rolls a new random game, keeping the category if one was picked, and
prefers lists the player hasn't played in that mode. Before play it sits in its own box right of the guess panel.

**Never spoil a daily.** Random rolls (list or Blitz) never land on today's list, played or not, or on a future
day's: a day's list joins random play the day after it runs. `daily.json` still names a `blitz` per day (the
scheduler writes it; only old links read it), and such a list is ordinary free play.
**New lists debut as dailies** (owner): a list built with `debut` stays out of random play, list and Blitz, until its
first day as Today's list has run, scheduled or not (`heldDebuts`); the scheduler runs debut lists first. Today's list
is always one that never ran. The judge's bars (docs/JUDGE.md): a typical player averages 5 to 6 on Today's list; a
list offered as a Blitz needs a deep pool, broad recognition and clean data.

## 4. Screens

Every screen's header ends in the **menu** key: a panel of tiles (Play: Today's list, Random list, Random Blitz and
Fathom; Yours: Archive, Past runs, Stats; More: Settings, How to play, Feedback, Privacy), the current screen's tile
marked. The account lives in Home's header, not in the menu and not in a row of its own (owner, Nov 5 and 6): one
**account key** left of the sound key, the same keycap, in builds with accounts only. Its pixel player is hollow when
signed out, lit cyan when signed in, carries a pink dot for sync trouble (offline, couldn't sync) or a sign-in that
didn't finish, and waits (hollow, tinted, disabled) while a sign-in comes back; its name and title say the state
("Account: signed in as <name>", never an email). It opens the sign-in sheet (which also creates accounts) or the
account sheet (name, sync state with try again, sign out, delete account, what we keep). **Free play needs an account after two games** (owner, Nov 14: "after a user plays more than once in free play, they
have to sign in with google to continue playing"), in builds whose accounts offer Google. Signed out, a player may
play `FREE_GAMES_BEFORE_SIGN_IN` (2, `src/game/free-games.ts`) free games: Random list, Random Blitz, Roll new list,
Play again, Play Blitz, or a `#p-`/`#blitz-` link. A list game counts from its first guess the list takes, a clue or a
give-up; a Blitz round once its clock runs; opening one counts nothing. Starting the next opens the **wall** over the
screen: "Sign in to keep playing", "free play is unlimited with an account. today's list is always free.", the Google
key, and a quiet key to today's list (Home once it's played). Closing leaves the player where they were; signing in
starts the game asked for. Never asked: dailies, Fathom, Past runs and their results, Stats, How to play; a game
under way always resumes. Inner screens have no
account key: their headers are full, and HOME is one press away (UX.md 19). **Settings** (`#settings`): the sound
switch and reset all progress (Fathom's too). **Fathom** (`#fathom`), the estimation game, out of beta since Nov 9
(owner: "ship it now"): five questions a game (estimates, a percent, a year, a name-it round), endless games, scored by
plain closeness, with no scoring line on screen (owner, Nov 14; How to play explains it, UX 21), out of 500 (docs/FATHOM.md). Its key is
in Home's Free play and its tile in the menu's Play group; its games are in Past runs and its totals in Stats, and they
sync with an account like list games. No daily Fathom (owner: maybe later, if it's popular).

1. **Home:** Today's list (one key across the row), then directly Free play (Random list, Random Blitz, each with a floating by-category picker that offers only categories with at least 3 lists a roll can land on, and Fathom, its line "Guess the number: 5 questions" where the others count their lists ("5 questions" below 390px): under them on a phone, the row under the pair, one line high, from 640px);
   Your games (Archive, Past runs, Stats); your record (days in a row, most in a row). Home keys carry no mode tags; elsewhere tags name the mode (LIST, BLITZ). Home never names today's list: the
   topic is the surprise (owner, Nov 7).
2. **Game:** title card with the prompt and score (no average during play: it's revealed on the results; no Play
   Blitz key there, owner Nov 8: "for simplicity"); lives; 10 rank slots, each empty one with a
   clue magnifier; feedback line; chips for life-costing misses.
   Blitz's title card shows the prompt only when it adds words beyond the title, "name as many <noun> as you can", and
   its scoring rule ("#1 gets 100, smaller numbers get less, down to 10"), repeated on the results. A found row opens
   its fact on a tap; no caption says so (owner, Nov 8).
3. **Results:** score, the average and histogram (where you stand: "better than 36% of players", "... today" on a
   daily), full list with values, then ranks 11 to 20 shown directly under a divider labelled "11 to 20", quieter than
   the top 10 (life-costing guesses in pink; "11 to 15" when the list stops sooner; none on Blitz; owner, Nov 14: "just
   show it directly"), source link, share, and the next game of the same mode: Roll new list (a new random game) in
   free play, Random list after a daily. **The modes stay separate** (owner, Nov 14: "moving in a direction to keep the
   game modes separate"): a list's results never offer Blitz, and a Blitz's results never offer its list (UX 15). The
   archive is a table, one row per date: number, date, the list's title and its score or "not played"; each row opens
   its own one-try game.
4. **Past runs:** every game played, under a header per day, one tag per row ("List #22", "Blitz #22", "Fathom", never wrapping). Each row opens its own run (the board
   as it ended, or the Blitz round), which offers Play again (a fresh free game on that same list), the only replay
   in the game, except on a list held today (today's list or a future day's): "back in free play after its day". A
   Fathom game's row has its five squares for a title and its total ("328/500"); it opens that game's results
   (`#fathom/run-<startedAt>`, with the date it was played), which offer New questions, or Back to your game while one is
   under way.
5. **How to play:** closed by default; the footer key opens it as a dialog over the page. Its last rule is Fathom's, and
   the only place its scoring is written.
6. **Stats** (`#stats`, Your knowledge): first tries on each list against the players' average, overall, by category and by topic; placeholders
   before the first game (the three headline figures read "--", "0", "--" in one row). Then Fathom's own card: games,
   avg / 500 and best / 500 over every finished game, "0", "--", "--" before the first. Every screen opened forward
   starts at its top; Back returns to where the player was.

## 5. Visual direction: Krillion's language, arcade high-score table

Krillion (krillion.io; krillion.cc is a copycat) is the reference the owner likes. Borrow its visual language, not its ocean art: our
metaphor is a **retro arcade high-score table**, which a top 10 already is.

**From Krillion (observed):**
- Dark only. Page `#050a14` with a navy gradient (`#0d1e38` → `#020409`). Panels `#0d1830` / `#101d33`,
  glass `#08182e` at 85-95%. Hairlines `#7d93b8` at 22%.
- Text `#e8f1ff`, muted `#7d93b8`, labels `#8fa3c4`.
- Accents: cyan `#4de3ff` (primary), pink `#ff5d8f` (go buttons, wrong), gold `#ffd166` (suggestions, #1),
  red `#ff5252` (danger). No green anywhere, except the 2nd and 3rd rank numerals (lime `#b6f36a`, mint `#5cf2a8`,
  from the squid's limbs), which the owner kept (Nov 7).
- One font: **VT323** (Google Fonts), weight 400, pixel-crisp. Body 22px/1.35. Hierarchy from size, color,
  UPPERCASE and wide letter-spacing (0.25em buttons, 0.3em labels).
- Keycap buttons: 52px tall, radius 6, hard shadow `0 5px 0 #02060f` (pink key `0 5px 0 #a8365d`), press sinks 3px.
- Input 52px with a constant cyan glow ring. Cards: hard unblurred shadows, faint scanlines
  (`repeating-linear-gradient(0deg, #ffffff06 0 1px, transparent 1px 3px)`).
- Two-beat reveal: the world reacts first, then the verdict card fades and rises (0.35 s).
- Keyboard loop: autofocus, type, Enter. Inline confirm (QUIT → SURE?) instead of modals.
- Copy: short UPPERCASE labels, dry lowercase captions.
- Mobile: one column, controls wrap, nothing clipped.

**Ours:**
- The 10 slots are a high-score table: big pixel rank numerals (1ST, 2ND ...), names typed in like initials when found,
  #1 in gold. Missed slots revealed muted at the end.
- Lives as 5 pixel hearts or credit squares in the header; losing one flashes pink.
- Results: score in huge pixel type, the full table with values, share text with one square per rank and a link.
- Respect `prefers-reduced-motion`. Visible focus rings.

Screenshots of Krillion, taken by an earlier agent, are in
`/tmp/claude-0/-home-user/2375e5ee-46dc-5ea2-a7f4-fd0dd013e321/scratchpad/krillion/shots/` (start with
`d_009_p1_ready.png`, `d_030_p1_result.png`, `mu_008_p1_ready.png`, `d_126_summary_view.png`). Its stylesheet is in
`.../krillion/css/`.

## 5a. UI rules (checked by tests)

- **Interaction states never move anything.** Hover, focus and press change color, background, shadow, opacity,
  outline and transform only; never size, spacing, borders, font, display or position. Something that appears on
  hover or focus reserves its space (visibility, opacity) or floats over the page (absolutely positioned).
  `npm run lint:css` checks the stylesheets; `e2e/states.e2e.cjs` hovers, focuses and presses every control on every
  screen at three widths and fails if any element moves or resizes. (Nov 3: the Today key grew 89 to 116px on hover
  because a desktop size override lost to the hover rule's full size, and the ENTER cap widened the Blitz key.)
- **A breakpoint override covers every state** of what it changes. Simplest: state rules carry no layout at all.
- **Nothing means something only on hover.** Phones have no hover. Labels explain themselves ("average", not
  "par"), and any extra explanation opens on tap as well as hover, floating over the page.
- **Phone first:** every screen is designed at 390px, then widened.
- **Visual baselines** (`e2e/baselines/`, fixed fixture data) are the reference look. A change to them is reviewed
  image by image before it merges.

## 6. TENtacle: the glow squid (direction from October 2026)

The game is now TENtacle, and it grows its own identity on top of the arcade table: **a squid has ten limbs (eight
arms, two long tentacles), and a top 10 has ten slots.** Every answer found is one limb lit.

- Look: an original pixel-art glow squid. Blocky, chunky pixels, a voxel/Minecraft-like vibe, bioluminescent glow in
  the existing palette (cyan glow, pink and gold accents on navy). Not a copy of any existing sprite.
- Feedback loop (owner-approved ideas):
  1. The squid fills in: one limb lights per answer found; ten lit is a full glowing squid.
  2. The find flash (replaced the tentacle grab in November 2026): the lit limb flashes white-hot, a shimmer runs
     root to tip and the squid hops head-first; #1 and #2 hop and glow bigger. About half a second, no delay to state.
  3. Ink lives: five ink sacs; a life lost squirts ink that dims the screen for a beat; running out ends in a cloud.
  5. Sound (optional, off by default): each rank is a note (#1 highest); a perfect game ends on a chord.
  6. Blitz glow: fast hits make the squid glow brighter (momentum, no scoring change); the score bumps with each
     gain, harder for bigger ones; passing your best flares.
- Rewards follow value, never obscurity: the game rewards big answers, not niche ones.
- Decorations are aria-hidden and never delay game state; tests and screen readers see the final state at once.
  `prefers-reduced-motion` gets static states.
- Play events (`src/game/events.ts`, `onPlay`) are how feedback layers hear about finds, misses, hints and ends.

## 7. The ocean (MVP, October 2026)

The squid leaves the header and lives in a deep-ocean world behind the whole app.

- Backdrop: a retro pixel deep-sea scene behind every screen, drawn at low resolution and scaled up (chunky
  pixels): faint light from far above fading to near-black, drifting marine snow, distant glowing jellies, rocks and
  kelp on the seabed, parallax layers for depth.
- Panels become tinted glass: slightly see-through, so the ocean and the squid show faintly behind the board and the
  text box. Text contrast stays readable.
- One squid. On wide screens it lives in **open water**: the viewport minus every glass panel (`[data-glass]`), so it
  is always in view and never behind the board. On phones and narrow layouts, where no strip is wide enough, it
  roams behind the glass instead. It swims head-first with pulse-and-glide strokes, never backwards.
- Reactions: its limbs light for answers found; a find makes it dart and glow; a lost life darts
  off in a puff of ink (ink always comes with a dart: it leaves from the jet, never in place, owner Nov 9); a perfect 10 does loops; Blitz momentum makes it swim faster and glow brighter; idle,
  it sinks and dozes.
- A find also gives a quick wiggle in time with the limb's flash (bigger for a top 3; half size for a Blitz hit outside
  the top 10). A tap on the squid's own pixels makes it blush, wave and pop a pixel heart; three taps in a row, a spin,
  a ring of sparks and an ink puff as it darts off (a small sound when sound is on). It never takes a tap meant for a
  control, and with reduced motion it only blushes.
- Later: a seafloor that grows from your history, a lanternfish school for the streak.
