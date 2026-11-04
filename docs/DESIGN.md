# TENtacle: design

Formerly Top Tens. Name the top 10 of a ranked list. Five lives.

## 1. Rules

- 10 hidden slots, ordered by rank. A correct guess reveals its slot (rank, name, source value).
- 5 lives. **Only an accepted answer outside the top 10 costs a life**, and the game shows where it ranks ("Austria is #113").
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
  last life.
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
Modes: daily (Today's list and Today's Blitz, from `public/puzzles/daily.json`) and free play (a random list or Blitz,
optionally by category). **Dailies are one try each**, archive dailies included: a finished daily always reopens on
its result. Free play is endless: Roll again rolls a new random game, keeping the category if one was picked, and
prefers lists the player hasn't played in that mode.

**Separate topics.** Today's list and Today's Blitz are different lists, because a good list rewards knowing the
top 10 and a good Blitz rewards breadth. `daily.json` gives every day a `blitz`; a day without one gets a
date-seeded Blitz list that isn't that day's daily or a later one. Random rolls (list or Blitz) never land on today's
list or Blitz, played or not, or on a future day's: a day's pair joins random play the day after it runs.
**New lists debut as dailies** (owner): a list built with `debut` stays out of random play, list and Blitz, until its
first day as Today's list or Today's Blitz has run, scheduled or not (`heldDebuts`); the scheduler runs debut lists
first. Today's list is always one that never ran. A day never waits for a new Blitz: when none is approved, its Blitz
reruns a list from random play (another category than the day's list, at least 30 days after its last Blitz). If a Blitz
ever runs on its day's own list, it shows only the player's hits
until that list is finished (`blitzHold`). The judge's bars (docs/JUDGE.md): a typical player averages 5 to 6 on
Today's list; Today's Blitz needs a deep pool, broad recognition and clean data.

## 4. Screens

Every screen's header ends in the **menu** key: a panel of tiles (Play: Today's list and Blitz, Random list and
Blitz; Yours: Archive, Past runs, Stats; Account: sign in, or the account and sign out; More: Settings, How to play,
Feedback, Privacy), the current screen's tile marked. Sign-in lives there, not on Home. **Settings** (`#settings`):
the sound switch and reset all progress.

1. **Home:** Today's list and Blitz; Free play (Random list, Random Blitz, each with a floating by-category picker);
   Your games (Archive, Past runs, Stats); your record (days in a row, most in a row). Home keys carry no mode tags; elsewhere tags name the mode (LIST, BLITZ).
2. **Game:** title card with the prompt, score (no average during play: it's revealed on the results) and a Play
   Blitz key; lives; 10 rank slots, each empty one with a
   clue magnifier; feedback line; chips for life-costing misses.
   Blitz's title card shows the prompt and "name as many <noun> as you can".
3. **Results:** score, the average and histogram (where you stand), full list with values, source link, share, Roll
   again (a new random game).
   A finished daily offers Today's Blitz and Random list instead. The archive is a table, one row per date: number and
   date, then a List cell and a Blitz cell (title, and score or "not played" under it), with "List" and "Blitz" named
   once at the top; each cell opens its own one-try game.
4. **Past runs:** every game played, under a header per day, one tag per row. Each row opens its own run (the board
   as it ended, or the Blitz round), which offers Play again (a fresh free game on that same list), the only replay
   in the game, except on a list held today (today's pair or a future day's): "back in free play after its day".
5. **How to play:** closed by default; the footer key opens it as a dialog over the page.
6. **Stats** (`#stats`, Your knowledge): first tries on each list against the players' average, overall, by category and by topic; placeholders
   before the first game.

## 5. Visual direction: Krillion's language, arcade high-score table

Krillion (krillion.io; krillion.cc is a copycat) is the reference the owner likes. Borrow its visual language, not its ocean art: our
metaphor is a **retro arcade high-score table**, which a top 10 already is.

**From Krillion (observed):**
- Dark only. Page `#050a14` with a navy gradient (`#0d1e38` → `#020409`). Panels `#0d1830` / `#101d33`,
  glass `#08182e` at 85-95%. Hairlines `#7d93b8` at 22%.
- Text `#e8f1ff`, muted `#7d93b8`, labels `#8fa3c4`.
- Accents: cyan `#4de3ff` (primary), pink `#ff5d8f` (go buttons, wrong), gold `#ffd166` (suggestions, #1),
  red `#ff5252` (danger). No green anywhere.
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
- Reactions: its limbs light for answers found; a find makes it dart and glow; a lost life inks
  where it is and darts away; a perfect 10 does loops; Blitz momentum makes it swim faster and glow brighter; idle,
  it sinks and dozes.
- Later (not in the MVP): a seafloor that grows from your history, a lanternfish school for the streak, tap tricks.
