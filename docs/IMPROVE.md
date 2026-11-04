# Improvement loop

The coordinator session runs this on a schedule. Each cycle improves a few existing lists and the way lists are
built, so quality compounds instead of being fixed one complaint at a time. Log every cycle in
`docs/IMPROVE_LOG.md`.

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
| Par read too high, then city visitors at par 1 | a crude synthetic crowd | compressed crowd model in par.ts (pars 3-7); real stats (Phase 1) replace it at 50 players |
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
| "Play again" on a random list read as replaying the same list | a label that doesn't say what happens | "Roll again" (primary) on free-play results; Play again only in Past runs; UX.md principle 1 |
| A random list rolled today's Blitz topic and showed its answers | random play overlapping the dailies | `rollHoldouts`: today's pair and every scheduled day held from random play; daily.test.ts and e2e |
| Roll again seemed missing on a Random Blitz (it sat on the score line) | controls placed where players don't look | Roll again sits right of Guess on both screens; reroll.e2e.cjs checks the Home key path |
| "Japan" cost a life on Most populous European countries | a world universe on a regional list | regional universes in the pipeline; validate.ts error (cycle 7) |
| Four header keys pushed the five lives under the sound key on 360px phones | header crowding on narrow phones | slimmer header keys under 380px; the narrow-phones test in e2e/menu.e2e.cjs (320/360/390) |
| "saudi aramco" filled Saudi Arabia | a name read as an answer plus who made it | `leadingName` is skipped when the whole guess is a known name; match.test.ts |
| "Most-followed Facebook pages" was a worse Instagram list, not fun to play; X accounts the same (dropped Nov 5) | near-duplicate lists (same answers, weaker version) | removed; topic gate in step 1: no weaker copy of a list the bank has; judge brief: compare with the bank's closest list |
| Lakes ran Nov 5 as the third Geography daily in a row; the owner found it weak and it had run in free play | category runs in the schedule; dailies the owner wouldn't pick | real.test.ts: no category three days running from Nov 3; `ownerVeto` in a verdict keeps a list out of Today's list (schedule.ts), and judges keep it |
| The Google client ID was pasted into Vercel with a trailing newline | env values with stray whitespace | `src/net/config.ts` trims every public env value and ignores a client ID that isn't one; index.test.ts, and the e2e Google build uses a client ID ending in "\n" |
| Dailies came from lists already in free play; a new list joined random play the moment it was built (owner) | new lists played before their debut as a daily | `debut` in topics.ts, written to index.json (validate.ts: the flags agree); `heldDebuts` (daily.ts) holds them from random lists and Blitz until their first day has run, daily.test.ts and e2e/daily-topics.e2e.cjs; real.test.ts: every debut list is waiting or has run, none waits for good; schedule.ts runs debut lists first, schedule.test.ts |
| Nov 23 and 24 had no Today's Blitz: no new list was approved for one | a day waiting for a new Blitz pick | `assignBlitz` reruns a list in random play (another category than the day's list, 30 days after its last Blitz, never a later day's list), schedule.test.ts; real.test.ts checks reruns follow those rules |
| National parks facts didn't say which state each park is in (owner) | facts on a list of places that don't say where the place is | `placesIn` on every place list (validate.ts warns when a list's noun is places without it); validate.ts warns on a top-10 fact naming no country, state or province (gazetteer.ts `DIVISIONS`) or planet, and validate.test.ts runs it on every built place list; facts files record the source table's location as `where`; judge brief step 6 (the right place); build.test.ts: built facts are what a rebuild gives, so a hand-patched daily keeps them |

## What good looks like

- Titles say what the player is naming; misses say how many of what the list holds.
- Every obvious guess either scores with a rank and figure or is honestly outside the source, and an obvious miss
  shows a number (a rank, or a dated figure from the page) wherever the source has one.
- Every top-10 answer has a fun fact with a source.
- Matching reads guesses the natural way (CLAUDE.md, docs/DESIGN.md §2): partial knowledge helps, unrelated words
  never become answers.
- Dailies: a typical player averages 5 to 6. Free play: fair and fun. Oddball: anyone can throw guesses.
