# Improvement loop

The coordinator session runs this once a week (Fridays, 10:21 Hong Kong time). Each cycle improves a few existing
lists and the way lists are built, so quality compounds instead of being fixed one complaint at a time. Log every
cycle in `docs/IMPROVE_LOG.md`.

## Weekly lineup (the owner approves)

Today's list is always fresh: a new topic is built as a `debut` list, runs first as Today's list, and joins free play
the day after. Every Friday the coordinator sets the coming week (Monday to Sunday) and the owner approves it (owner,
2026-11-05: "set the next week's daily list and daily blitz topics, and then you send me a concise report ... I will
approve or disapprove ... I'll tell you which specific ones to swap out ... efficient and organized"):

1. **Pick the week:** 7 Today's lists and 7 Blitzes, within the variety rule (step 1 below), the schedule checks
   (no category three days running, nothing twice) and his taste in `docs/OWNER_PICKS.md` (no two similar lists in
   one week). Today's lists are new `debut` topics, or approved debut lists not yet run; a Blitz may be a new list or a
   rerun of one that already ran. Keep 3 or 4 spares that are built and judged, ready for swaps.
2. **Build and judge** every new list (data agent; a `list-judge` on each); drop any that fail and pick again.
3. **Report** as one short Claude doc, "TENtacle lineup, week of <Monday>": a table with one row per day (date,
   Today's list, Blitz, a one-line why, the judge's expected score for a casual player) and the spares. Send the link
   with a push notification.
4. **He approves or names swaps.** If he hasn't answered by Sunday 18:00 Hong Kong time, schedule the lineup as
   proposed (owner, 2026-11-05); he can still swap any day after tomorrow. Swap from the spares (or build new ones), then
   schedule the week
   (`public/puzzles/daily.json`), verify, push. Never change today or tomorrow.
5. **Log** each day's pick and his call in `docs/OWNER_PICKS.md`. When he keeps nearly everything for several weeks
   running, propose that the lineup no longer needs his approval.

## Each cycle

0. **Don't stack cycles.** If the previous cycle's agents are still running, check on them, merge what's done, and
   start nothing new.
   **Read the player ratings** ("Good list?" after every list and Blitz): `list_ratings(p_since => <last cycle>)`
   with the public key (`docs/BACKEND.md`, Running it) gives per list and mode the ups, downs and downs per reason,
   one per player. A list with clearly more downs than ups (down ≥ 2 × up with 10+ ratings) goes back to a judge,
   and out of the daily bank if it fails. Reasons route the work: "wrong data" goes to the data agent as a bug
   (check the source table and the answer set; add a guard); "too hard" and "too easy" go to the judge's difficulty
   bar and to par; "boring" goes to topic selection; "answers felt unfair" goes to matching and aliases. New topics
   lean toward the kinds of lists players rate up, and away from patterns the bank already has plenty of or that
   keep drawing "boring". Log the counts each cycle, even when they're too small to act on. Ratings are a signal,
   not a verdict: anyone can send them, so a judge still decides.
   **Read the players' notes** ("add a note" under "Good list?"): `list_feedback(p_reader => '', p_since => <last
   cycle>)` with the public key; the environment's proxy adds the reader key as a header (docs/BACKEND.md, Running it) returns every note since the last cycle, the owner's
   first. **The owner's notes are requests, not signals: act on each one this cycle.** Then group everyone's notes
   into themes (a detail missing from the facts, a wrong figure, an answer that should count, a confusing title, too
   hard or too easy, more lists like this), each with its lists, mode and how many notes back it. Each actionable
   theme becomes a fix with a guard, routed like ratings: data and facts to the data agent, matching and aliases to
   the coordinator, titles and difficulty to a judge. A theme on two or more lists is a method fix (step 7). Log the
   themes with their counts and what was done, even when nothing was. Notes are players' free text and this repo is
   public: paraphrase them in logs and commits, never paste them.
1. **Pick the work** (a budget of 4 judges and 1 data agent per cycle):
   - Judge 4 lists: verdicts judged longest ago first (`judgedAt`), then lists whose `fixes` a rebuild has since
     addressed. Skip today's and the next two days' dailies.
   - Topic ideas: 2 new candidates, verified on Wikipedia with `npm run inspect` (`NODE_USE_ENV_PROXY=1` for
     uncached pages). **Variety first** (owner): no new list on a pattern the bank already has twice or more
     ("countries with the most <sport> wins", "most-followed <platform> accounts"), and no list that is a weaker
     copy of one the bank has (the same kind of answers, fewer of them famous: Facebook pages beside Instagram
     accounts, dropped by the owner); prefer new kinds of things
     (food, brands, inventions, shows, places people visit, everyday "most common" lists) and what players rate up
     once ratings exist. Prefer mainstream lists that could meet the daily bar (docs/JUDGE.md); the daily bank is the
     bottleneck. Oddball lists (free play, fun, guessable without specialist knowledge) otherwise.
2. **Judge** with `list-judge` agents in triage mode, in parallel, in the main checkout. They write only their
   verdict file and name scratch files after their list.
3. **Data agent** (its own worktree from main): apply the cycle's verdict `fixes` (junk aliases, missing short forms,
   demonyms, parse bugs, stale figures), and build new topics that passed the topic gate (title names the answer
   type, broad answer set, a casual player finds 4+ before looking), each with `debut: true` (step 5). Rebuild only the affected lists, then
   `validate.ts` and `scripts/judge/par.ts`. Its own verdict on a new list carries `"by": "builder"`: par uses it,
   the scheduler doesn't, until a real judge has looked.
4. **Coordinator:** matcher findings in `src/game/match.ts` with unit tests; the leak audit (wrong guesses that get
   an answer offered); review the data branch; copy its `.cache/wiki` newer-wins (`cp -ru`, so a refreshed page
   replaces the stale one); merge; `npm run verify` on the merged main; push main (it deploys).
   Never rebuild today's or tomorrow's daily list.
5. **Schedule. New lists debut as dailies** (owner, Nov 4): a new list runs first as Today's list (or Today's Blitz),
   and joins random play the day after. Every new topic is built with `debut: true` (scripts/topics.ts, written into
   its index.json entry): random lists and Random Blitz never offer it until its first day has run, a date before
   today in daily.json, scheduled or not (`heldDebuts` in src/game/daily.ts). Schedule every newly approved daily
   right away (`scripts/schedule.ts <n> --write`): Today's list takes debut lists before lists already in random
   play, never the day before's category when another will do. Every day gets its Blitz (`--blitz --write` fills any
   day missing one): a list that never ran first; when none is approved, a rerun of a list that already ran (in
   random play), not in the day's list's category, not a Blitz in the last 30 days, not on a later day. A day never
   waits for a Blitz pick. The scheduler names new lists still waiting for a judge, and any a judge sent to free
   play only: drop their `debut` (they would wait for good; real.test.ts fails on one).
6. **Log** one entry in `docs/IMPROVE_LOG.md`: lists judged and decisions, fixes shipped, the leak rate, topic
   ideas (built, queued or dropped), and any method change.
7. **Fix the method, not just the list.** When the same kind of problem shows up on two or more lists (a demonym
   costing a life, a table parse dropping rows, a misleading title), fix it in the pipeline, the matcher or the
   judge brief, and say so in the log.

## Every reported bug leaves a guard

When a player (or the owner) finds a bug, fix the instance and then add the guard that stops the whole class: a
`validate.ts` check, a test, or a line in the judge brief. Record it in the table below, so the method only gets
stronger.

| Reported | Class | Guard |
|---|---|---|
| "Biggest CO2 emitters" left players guessing cars | titles that don't say what you're naming | validate.ts: every puzzle has a `noun`; judge brief: title names the answer type |
| "pope" became "Don't Bother Me, I Can't Cope" | unrelated words autocorrected into answers | match.ts rules + tests; leak audit each cycle |
| Detective Conan had no fun fact | top-10 answers without a fact (new lists, renames) | facts looked up by normalized name, article and aliases; validate.ts errors on a top-10 answer without a fact |
| Singapore, Tokyo, NYC "isn't in the top 10" with no figure | misses with no number when the source ranks only 10 | unranked answers take their rank and figure (with year) from the page's other tables ("#6 in 2024"); any other miss says "outside the top N"; validate.ts flags lists whose misses can't show a figure |
| Par read too high, then city visitors at par 1 | a crude synthetic crowd | compressed crowd model in par.ts (pars 3-7); real players blend in as they come (W = 30, see the Nov 5 row) |
| Music artists titled "best-selling" but ranked by certified units (Drake #1, the Beatles #11) | a title that hides an unexpected measure | judge brief: the title names the measure when it isn't the obvious one, else `fix-first` |
| Capitals had Ulaanbaatar ranked and "Ulan Bator" unranked (two lives, one city) | one place under two names | validate.ts warns when an unranked universe member duplicates a ranked row; merge with `aliases` |
| "bookworm" and "relentless" found Amazon | junk redirects on company and celebrity lists | shared `COMPANY_JUNK` and `CELEBRITY_JUNK` lists in scripts/aliases.ts, applied to every such list |
| "humans" offered Destroy All Humans!, "water" Fritz-Walter-Stadion | an ordinary word read as part of a longer name | plain words in the lexicon (`bankPlainWords`, `isPlainWord`): the lexicon alone decides, keeping the words of top-10 answers, ranked people and entries with a figure; scripts/lexicon.test.ts |
| "farewell tour" cost a life as Cher's, not Elton John's #4 | a curated alias group applied before all its entries exist | `seedIntent` in build.ts waits for the whole group |
| "ed sheeran divide" filled in Sheeran's other tour | a shared name (the artist) read without the rest of the guess | `leadingName` lets the rest pick among the entries sharing the name; match.test.ts |
| Concert-tour misses from yearly tables showed no figure; Michael Dell showed his rank from 2000 | one-row-per-year tables, and old figures winning over new ones | `perYear` dated labels (build.test.ts); the newest dated figure wins |
| Instagram's cache rolled back to a page with a #10/#11 tie | cache merges keeping the older file | the coordinator merges caches newer-wins (step 4) |
| Nov 4's Blitz was Broadway, Nov 2's list (picked before the no-repeat rule) | a topic running twice | real.test.ts: no list runs twice from Nov 2, every day has its own Blitz; builder verdicts never schedule |
| "tour" offered top-10 tours four at a time until all were found | a list's subject or category word handing over answers | match.ts: a list's noun words are category words; a word shared by 3+ top-10 answers, or a crowd with 2+, asks for more; real.test.ts checks every list's noun; judge brief: type the subject and categories alone |
| "toyota" offered only Mirai/Prius, a life each | top 10 named one way, the pool another | rows named like the pool ("Toyota Corolla"), the model alone an alias |
| "barrel" filled in Brazil, "action" the Amazon | ordinary words stretched into names by the typo budget | match.ts: a plain word gets one slip at most, onto a ranked answer; match.test.ts |
| "bridgerton 2" put Season 1 in the box, "frozen 3" Frozen | a name plus a different number | `leadingName` requires the number to match; match.test.ts |
| One show, several ranked seasons | parts of one thing ranked apart | `part` in topics.ts: the show's name and redirects only on its top season; build.test.ts |
| Tiger, Federer, McGregor cost lives on a 2026 list | old rankings accepted on a one-year list | judge brief: on a one-year list only recent near misses cost a life |
| Burrow cost a life with no figure; One Direction's tour scored nothing in Blitz | threshold tables read as names only; unranked answers without a stat | dated `figure` from the cell's latest year; `gross` infobox kind, never replacing a table stat; build.test.ts |
| Tour facts didn't say whose tour | facts omit what players answer by | judge brief: the fact names it |
| "peaky blinders" cost a life as an untitled Netflix sequel | placeholder rows ("Untitled ... series", "TBA", "Awaiting release") read as answers | the build skips them; validate.ts errors on one; build.test.ts, validate.test.ts |
| Every Netflix original cost a life with no figure (and 14% of the leak audit) | a huge pool of answers with nothing to learn from | only entries with a figure are answers; the rest are `knownOnly` names (scripts/known): free, still known to the lexicon |
| "prescott", "soto" were free while "dak prescott" cost a life | near misses with a figure not typed by surname | unranked people with a figure get surname short forms, same rule as ranked rows |
| "labradoodle" scored as Labrador | famous non-answers of the list's kind corrected into answers | crossbreeds as `knownOnly`; builders replay the list's famous non-answers |
| English Pointer merged into German Shorthaired Pointer | a junk redirect claiming another entry by its article | build.ts: junk aliases never match a namesake by article or link |
| "season 3" gave away a top-10 season; "music", "band" offered tours | words that name no entry alone | "season", "part", "music", "band" are category words; the subject with a small number names nothing; match.test.ts |
| "john rahm" wasn't Jon Rahm; "planes" offered Our Planet; "doodle" Poodle | slips judged on the wrong part, or onto obscure names | a slip beside a shared word counts; obscure pool names (no rank, no figure) need the first and last letters; a plain word's slip keeps its first letter; simulated typos of 2,088 answers checked each change |
| "cubs", "mets", "brewers" not recognized on World Series titles ("cowboys" on Super Bowl wins) | universe nicknames lost when the team is a table row | build.ts gives a team universe member's names to the row it merges with; validate.ts errors when a team's nickname doesn't reach it |
| Padres, Rays (0 titles) showed no figure | zero counts dropped as "no figure" | rows counting zero show "0", never scoring in Blitz |
| "golden doodle", "aussie doodle", "monster menendez" read as answers | famous non-answers in their usual spellings | `knownNames` in topics.ts; a known name matches however it's spaced; builders replay famous non-answers as people spell them |
| "charli xcx" offered Charli D'Amelio | part of a name followed by someone else's | `leadingName` skips an entry whose name lacks the rest of the guess; match.test.ts |
| "steel" offered Steel Pier because a film list ranks Man of Steel | plain words decided across the bank | the matcher decides per list: a word is plain unless a notable entry on this list carries it |
| "squid game second season" read as Season 1 | ordinals and instalment words | ordinals count as digits; "season", "part", "of" set aside around a number |
| The Today key grew 89 to 116px on hover (desktop); the ENTER cap widened the Blitz key | interaction states changing layout; a breakpoint override losing to a state rule | `npm run lint:css` (no layout in state rules); e2e/states.e2e.cjs hovers, focuses and presses every control at three widths; DESIGN.md §5a |
| "par 6" not understood (asked twice) | jargon labels, meaning only on hover | no average during play; the results say "Players avg"; DESIGN.md §5a and UX.md: labels explain themselves, explanations open on tap too |
| "Play again" on a random list read as replaying the same list | a label that doesn't say what happens | "Roll again" (primary) on free-play results; Play again only in Past runs; UX.md principle 1; Fathom's PLAY AGAIN (it draws new questions) is NEW QUESTIONS, and fathom.e2e.cjs fails on "again" in that key (Nov 5 review) |
| A random list rolled today's Blitz topic and showed its answers | random play overlapping the dailies | `rollHoldouts`: today's pair and every scheduled day held from random play; daily.test.ts and e2e |
| Roll again seemed missing on a Random Blitz (it sat on the score line) | controls placed where players don't look | Roll again sits right of Guess on both screens; reroll.e2e.cjs checks the Home key path |
| "Japan" cost a life on Most populous European countries | a world universe on a regional list | regional universes in the pipeline; validate.ts error (cycle 7) |
| Four header keys pushed the five lives under the sound key on 360px phones | header crowding on narrow phones | slimmer header keys under 380px; the narrow-phones test in e2e/menu.e2e.cjs (320/360/390) |
| "saudi aramco" filled Saudi Arabia | a name read as an answer plus who made it | `leadingName` is skipped when the whole guess is a known name; match.test.ts |
| "Most-followed Facebook pages" was a worse Instagram list, not fun to play; X accounts the same (dropped Nov 5) | near-duplicate lists (same answers, weaker version) | removed; topic gate in step 1: no weaker copy of a list the bank has; judge brief: compare with the bank's closest list |
| Lakes ran Nov 5 as the third Geography daily in a row; the owner found it weak and it had run in free play | category runs in the schedule; dailies the owner wouldn't pick | real.test.ts: no category three days running from Nov 3; `ownerVeto` in a verdict keeps a list out of Today's list (schedule.ts), and judges keep it |
| On a 320px phone the logo ran 12px past each edge (and its power-on sweep 6% more), so the phone widened the page and the sign-in sheet came out 326px wide | content wider than the narrowest phone | the logo scales with the width under 360px and the title clips the sweep; e2e/home.e2e.cjs checks the page stays 320/340 wide through the boot animation |
| Fathom: holding Enter after LOCK IN skipped the reveal (the repeating key pressed NEXT) | key repeat carrying into the next control | e2e/fathom.e2e.cjs holds Enter through a lock-in |
| Fathom: "1.5×" rendered in a fallback font; "299,792.458 km/s" on the reveal | glyphs the pixel font lacks; raw decimals on big answers | a plain "x" ("3 million times" for words); whole units past a thousand; fathom.test.ts |
| (Nov 5 review) Fathom: "1.2x too low · NEAR · 64" beside "1.4x too low · DEAD ON · 90" looked arbitrary | a relative score without its yardstick | the reveal said the question's typical miss ("most people miss by about 1.3x"), the results what a typical guesser scores (250); replaced since by one plain rule (the owner's row below); UX.md 21 |
| (Nov 5 review) Fathom: "spot on" beside 99 points | the words and the number disagreeing | spot on (within 1%) scores 100, and nothing else does; fathom.test.ts walks guesses around the answer on every typical miss |
| (Nov 5 review) Fathom: a reload on the results started a new game and lost the score | a finished game thrown away on reload | `resumable` reopens a finished game on its results; only NEW QUESTIONS draws again; fathom.test.ts, fathom.e2e.cjs (same total, same save after a reload) |
| (Nov 5 review) Fathom: "343 m/s" and "390000 km2" refused on questions in those units; "0.5m" in centimetres read 500,000, "8m" in minutes 8 million, "150t" in kilograms 150 trillion; "343 km/h" said "doesn't read as a number" | units typed after the number misread as scale words or not read at all | a unit table with kinds and sizes (fathom.ts): every form of the question's unit, exact conversion within a kind, "In centimetres, please." otherwise, and a unit of the question's kind is never a scale word; fathom.test.ts has every reported case, and every question in the bank reads its answer back typed with its unit |
| (Nov 5 review) Fathom: the decimal keypad (iOS) has no Return key, and with it up LOCK IN sat under the keyboard | the keyboard covering the only way to go on | with 600px of height or less, measured on the visual viewport (iOS lays its keyboard over the page), the cards come down to size; fathom.e2e.cjs at 390x450, 375x400 and an iOS-style overlay, on the bank's five longest questions: the question, the field and LOCK IN in view |
| (Nov 5 review) Fathom: the sonar lit the guess's band on both sides of the answer, faded the rest with opacity (gold read olive, cyan teal: the palette has no green), and labelled a tick "1e15" | decoration that misleads: two places lit for one guess, colours off the palette, numbers in powers of ten | one run lit, the one under the squid; unlit bands in darker shades of their own colours (`--band-dim`); ticks past the trillions or under a thousandth left out; the bands and ticks are gone since (the owner's row below) |
| (Nov 5 review) Fathom: lost at sea's square was a slate barely apart from an unplayed one, and shared as "□" | a played state that looks unplayed | a crossed outline in the label colour wherever its square shows, "×" in the share text; fathom.e2e.cjs measures the mark's contrast with an empty square and with the card; fathom.test.ts: no band shares as an empty box |
| (Nov 5 review) Fathom: at 320px "No negatives. It's more than zero." took two lines and pushed the keys down | a status line that wraps and moves the controls under it | the echo never wraps (17px under 360px, shorter messages, big numbers in words); fathom.e2e.cjs at 320px: every message and the longest numbers on one line, whole, LOCK IN where it was |
| (Nov 5, owner) Fathom: "Remove the thousand, million, billion option. As long as we give them appropriate units just have them type the number" | answers too long to type in their unit (86,000,000,000 neurons), patched with keys | no scale keys; each question in the unit a person would answer in, with a scale word for big counts (`billion neurons`, 86); the field groups digits as they're typed; check.ts: at most 6 digits before the point (check.test.ts); fathom.test.ts reads "8,800,000" in million people as 8.8; fathom.e2e.cjs: no scale key or word on the ask card, the grouped field and its caret |
| (Nov 5, owner) Fathom: the Sydney Opera House roof tiles: "didn't know what it meant, the large tiles or the individual ones; too many assumptions and background knowledge" | a count whose unit the player has to guess at | question dropped; FATHOM.md: what's counted must be plain without background knowledge |
| (Nov 5, owner after playing) Fathom: "most people miss by about x feels made up" (a judge's estimate), a guess 10x off still scored well where that was usual, and the sonar's bands didn't make sense | a score measured against an invented yardstick the player can't check; a gauge that needs a legend | one plain rule for every question (100 x (1 - d)^2, `typical` no longer read), said in one line on the first question and the results; other players only as real players, from 20 on a question; the sonar is the answer in the middle and the squid left or right by how far off, the miss under it; fathom.test.ts pins the rule's points and that `typical` changes nothing; fathom.e2e.cjs checks the rule in view before the first answer, no typical-miss lines, the squid's side and the 10x clamp, no bands or tick numbers; UX.md 21 |
| (Nov 5 review) Fathom: the Statue of Liberty question carried its definition, the bank card asked "how wide" for the long side, the shark was "aged", and the trees and bank card facts said nothing about the number | question copy that buries what is measured, and facts beside the point | FATHOM.md: the question names the thing, the definition says exactly what is measured, and the fact speaks to the number; fathom.e2e.cjs keeps the bank's five longest questions in view with a phone's keyboard up |
| Fathom: a long new question (109 characters with its definition) pushed LOCK IN under a phone keyboard | question text too long for a small phone with the keyboard up | `check.ts`: question plus definition at most 100 characters; the keyboard spec in e2e/fathom.e2e.cjs runs the longest real questions |
| rate.e2e "opening the reasons moves nothing" failed under load: the board's reveal animation (real time, not the fake clock) was still settling between two measurements | layout checks taken while CSS animations run | the check waits for every finite animation to finish and leaves out the squid (its own animation layer) |
| The Google client ID was pasted into Vercel with a trailing newline | env values with stray whitespace | `src/net/config.ts` trims every public env value and ignores a client ID that isn't one; index.test.ts, and the e2e Google build uses a client ID ending in "\n" |
| Dailies came from lists already in free play; a new list joined random play the moment it was built (owner) | new lists played before their debut as a daily | `debut` in topics.ts, written to index.json (validate.ts: the flags agree); `heldDebuts` (daily.ts) holds them from random lists and Blitz until their first day has run, daily.test.ts and e2e/daily-topics.e2e.cjs; real.test.ts: every debut list is waiting or has run, none waits for good; schedule.ts runs debut lists first, schedule.test.ts |
| Nov 23 and 24 had no Today's Blitz: no new list was approved for one | a day waiting for a new Blitz pick | `assignBlitz` reruns a list in random play (another category than the day's list, 30 days after its last Blitz, never a later day's list), schedule.test.ts; real.test.ts checks reruns follow those rules |
| National parks facts didn't say which state each park is in (owner) | facts on a list of places that don't say where the place is | `placesIn` on every place list (validate.ts warns when a list's noun is places without it); validate.ts warns on a top-10 fact naming no country, state or province (gazetteer.ts `DIVISIONS`) or planet, and validate.test.ts runs it on every built place list; facts files record the source table's location as `where`; judge brief step 6 (the right place); build.test.ts: built facts are what a rebuild gives, so a hand-patched daily keeps them |
| "Make logged in vs not logged in + create account on the home page" (owner): sign-in lived in the side menu | state a player needs at a glance hidden behind a menu | the account on Home (a key in its header since the next row); backend.e2e.cjs checks each state on Home (signed out, signing in, signed in by name, synced/offline/failed) and that the menu has no account section; UX.md 19 |
| "I hate how the sign-in thing takes up an entire row of space in the center ... a terrible waste of space" (owner): the account card took a row under Today's pair | status UI spending prime space | one account key in Home's header, left of sound (UX.md 19, DESIGN.md §4); backend.e2e.cjs: nothing comes between Today and Free play, which stand where the build without accounts has them at six sizes, signed in and out (home.e2e.cjs checks the plain build), and each state shows in the key's icon, dot, name and title; menu.e2e.cjs: every header key in both groups clears the logo at 11 widths, both builds |
| (Nov 4 review) "signed in as" could have shown an address on Home | personal data on an always-on screen | `homeName` cuts any name at its @, and the account key's name never says one (labels.test.ts); e2e `homeSignedIn` fails on an @ in the key's name or anywhere on Home |
| (Nov 4 review) the privacy page sent players to Stats and Home for things that had moved | copy naming a place that moved | backend.e2e.cjs follows each link in "Deleting it" to the account and to reset all progress |
| Mobile audit (owner: "some ui bugs on the mobile version"): 17 hover looks stuck after a tap | hover styles where there is no hover | lint:css fails on a hover rule outside `@media (hover: hover)` (css-states.test.mjs); touch.e2e.cjs taps keys twice and compares |
| Mobile audit: quick taps could zoom the page (no touch-action on rows, cells, links, fields) | double-tap zoom on controls | touch.e2e.cjs checks every control's touch-action and every field's size (16px+) |
| Mobile audit: GIVE UP, Close, thumbs, strips, text keys 28-36px tall | tap targets under 44px | `--reach` hit areas in index.css; touch.e2e.cjs presses 22px around every control at 320 and 390 |
| Mobile audit: "first letter? 1 l..." at 320/360px; "type a gues" in the guess box; Blitz names broken "INTERNATIO / NAL" | words that matter cut on the narrowest phones | touch.e2e.cjs at 320-430: the clue and its refusal whole, the placeholder measured against its box, no Blitz name broken inside a word |
| Mobile audit: "RANDOM / BLITZ" wrapped beside a one-line "RANDOM LIST" at 700-730px (a 360 x 740 phone on its side) | a key title wrapping at in-between widths, out of line with its pair | touch.e2e.cjs checks every Home play key's title is one line at 700, 740, 844 and 1024 |
| Mobile audit: no board row in view with the keyboard up on a 320px phone | the keyboard leaving no room for the game | touch.e2e.cjs at 320 x 318 and 375 x 387 |
| Mobile audit: viewport-fit=cover, but the top inset and the home indicator went unheeded | content under a notch or the home indicator | touch.e2e.cjs fakes the insets (CDP `Emulation.setSafeAreaInsetsOverride`), portrait and landscape |
| (builder, Nov 5) The CIA coastline table's "Congo, Republic of the" became an entry beside the universe's Republic of the Congo | names written the way an index sorts them: one country, two entries | validate.ts errors on an inverted index name at any rank (`invertedName`, validate.test.ts); `rename` such rows |
| (builder, Nov 5) Cape Verde and Cabo Verde, Macau and Macao, Turkey and Türkiye were two entries each on the landlocked list (another page's table beside the universe); tourism has Macau twice | one country under two names, unranked | build.ts merges a countries-universe member into the entry its usual name already names (`countryNames`, build.test.ts); validate.ts errors on one country twice in lists built from Nov 4 (`countryTwice`, validate.test.ts) |
| (builder, Nov 5) "st kitts" found nothing on the smallest countries | two-island states and "Saint" names without their everyday short forms | COUNTRY_FORMS lines for Saint Kitts and Nevis, Saint Vincent and the Grenadines, Saint Lucia, Antigua and Barbuda; build.test.ts checks every two-part state has its first part and every Saint its "St" |
| (owner, Nov 5) Players avg switched from estimate to real at 50 players, and early testers (about 0.9 above the estimate) skewed it | a cliff from a synthetic crowd to a handful of real players who aren't typical | blend with W = 30 virtual players (`ESTIMATE_WEIGHT`, src/net/crowd.ts: "(estimated)" until 30 real players); testers excluded (`stats_excluded` and owners, migration 20261105120000, BACKEND.md 2.7); crowd.test.ts (n = 0 is the estimate exactly, no cliff), supabase/migrations.test.ts, backend.e2e.cjs |
| (frontend, Nov 5) A click or tap on the clue's YES on #1 or #10 closed the confirm and bought nothing | a row's 44px reach (`::after` on the first and last rows) lying over a control inside the row | `.hint-ask` sits above the reach (`z-index: 1`); clue.e2e.cjs hit-tests YES on #1 and #10 and presses it, phone and desktop |
| (player, pixar-films) "monsters" filled in Monsters University (#10) and never asked about Monsters, Inc. (#14) | a franchise's name read as its higher-ranked title, when another title it starts is a notable near miss | match.ts `natural`: a typed guess that is only the first words of the top-10 title and of a near miss with a figure in the top 20 (`titleHead`, `notableNearMiss`) offers the fits; people and teams keep the natural reading (a surname ends the name; a first name or city starts one whose last word stands alone: "drew" is Brees, "new york" the Giants); match.test.ts, real.test.ts; heads shared by a top-10 and a top-20 name replayed on every list |
| (frontend, Nov 6) "Roll another list" ran 35px out of its results key and card at 320px | a longer label on a fixed-width key with no check that labels fit | below 360px the results keys tighten letter-spacing and padding; touch.e2e.cjs checks every results key keeps its label inside the key and the card |
| (launch audit, Nov 7) England (#6 with 6 Ballon d'Or wins) and Australia (#15 with 15 Nobel laureates) showed no number | `shownValue` hid any value whose digits equal the rank, meant only for rank-only columns written "#N" | `shownValue` hides only values written "#N"; state.test.ts "keeps a real figure that happens to equal the rank" |
| (launch audit, Nov 7) A Reddit link post showed no picture: no Open Graph tags, /og.png and /apple-touch-icon.png were 404 | the page's link preview never checked | og/twitter tags with absolute URLs, a 1200x630 share image drawn from the app (`e2e/share-image.cjs`), touch icon and favicon; `e2e/share.e2e.cjs` checks the built tags and the image sizes |
| (launch audit, Nov 7) The archive opened at Home's scroll position (scrollY 524) on a phone | the browser's scroll restore ran before a screen was drawn, and forward screens kept the old offset | App.tsx keeps each screen's scroll: forward opens at the top, Back returns to the saved spot; `e2e/scroll.e2e.cjs` |
| (launch audit, Nov 7) The Misses band was wider than the panels at game end on a phone | the band kept the dock's full width after leaving it | the band is a panel the board's width; `e2e/layout.e2e.cjs` "the Misses band lines up with the board and the results" (320, 390, 800) |
| (launch audit, Nov 7) Rolling in Science (one list) silently landed in Geography | the category picker offered categories a roll couldn't stay in | pickers hide categories with fewer than 3 rollable lists; `src/components/freeplay.test.ts` over the real index and every scheduled date |
| (launch audit, Nov 7) "Daily Blitz #22" wrapped "#22" onto its own line at 390; the empty Stats row was misaligned | tags and figures with no one-line check | "Blitz #22" / "List #22" never wrap (`e2e/history.e2e.cjs`); the empty Stats figures share one row (`e2e/par.e2e.cjs`) |
| (launch audit, Nov 7) "sacramento athletics" (the A's current name) wasn't taken on the MLB list; LA Angels, NY Mets, Florida Marlins, Cubbies and 10 more weren't either | team aliases covered only one name per team | current, short and recent names in `TEAM_SHORT` (scripts/gazetteer.ts); validate's "team nickname" check; aliases.test.ts "aliases as built: what players type" |
| (judge, painters) A junk alias "Eugčne Henri Paul Gauguin" (text decoded in the wrong code page) | redirects were taken without an encoding check | `mangledText` in scripts/aliases.ts drops such aliases at build; validate.ts "mangled text" fails any list carrying one |

## What good looks like

- Titles say what the player is naming; misses say how many of what the list holds.
- Every obvious guess either scores with a rank and figure or is honestly outside the source, and an obvious miss
  shows a number (a rank, or a dated figure from the page) wherever the source has one.
- Every top-10 answer has a fun fact with a source.
- Matching reads guesses the natural way (CLAUDE.md, docs/DESIGN.md §2): partial knowledge helps, unrelated words
  never become answers.
- Dailies: a typical player averages 5 to 6. Free play: fair and fun. Oddball: anyone can throw guesses.
