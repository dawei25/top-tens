# Improvement loop

The coordinator session runs this on a schedule. Each cycle improves a few existing lists and the way lists are
built, so quality compounds instead of being fixed one complaint at a time. Log every cycle in
`docs/IMPROVE_LOG.md`.

## Each cycle

0. **Don't stack cycles.** If the previous cycle's agents are still running, check on them, merge what's done, and
   start nothing new.
1. **Pick the work** (a budget of 4 judges and 1 data agent per cycle):
   - Judge 4 lists: verdicts judged longest ago first (`judgedAt`), then lists whose `fixes` a rebuild has since
     addressed. Skip today's and the next two days' dailies.
   - Topic ideas: 2 new candidates, verified on Wikipedia with `npm run inspect` (`NODE_USE_ENV_PROXY=1` for
     uncached pages). Prefer mainstream lists that could meet the daily bar (docs/JUDGE.md); the daily bank is the
     bottleneck. Oddball lists (free play, fun, guessable without specialist knowledge) otherwise.
2. **Judge** with `list-judge` agents in triage mode, in parallel, in the main checkout. They write only their
   verdict file and name scratch files after their list.
3. **Data agent** (its own worktree from main): apply the cycle's verdict `fixes` (junk aliases, missing short forms,
   demonyms, parse bugs, stale figures), and build new topics that passed the topic gate (title names the answer
   type, broad answer set, a casual player finds 4+ before looking). Rebuild only the affected lists, then
   `validate.ts` and `scripts/judge/par.ts`. Its own verdict on a new list carries `"by": "builder"`: par uses it,
   the scheduler doesn't, until a real judge has looked.
4. **Coordinator:** matcher findings in `src/game/match.ts` with unit tests; the leak audit (wrong guesses that get
   an answer offered); review the data branch; copy its `.cache/wiki` newer-wins (`cp -ru`, so a refreshed page
   replaces the stale one); merge; `npm test`, typecheck, build, e2e; push main (it deploys).
   Never rebuild today's or tomorrow's daily list.
5. **Schedule:** when fewer than 7 approved days remain, schedule newly approved dailies
   (`scripts/schedule.ts`), pacing difficulty and rotating categories.
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
| "saudi aramco" filled Saudi Arabia | a name read as an answer plus who made it | `leadingName` is skipped when the whole guess is a known name; match.test.ts |

## What good looks like

- Titles say what the player is naming; misses say how many of what the list holds.
- Every obvious guess either scores with a rank and figure or is honestly outside the source, and an obvious miss
  shows a number (a rank, or a dated figure from the page) wherever the source has one.
- Every top-10 answer has a fun fact with a source.
- Matching reads guesses the natural way (CLAUDE.md, docs/DESIGN.md §2): partial knowledge helps, unrelated words
  never become answers.
- Dailies: a typical player averages 5 to 6. Free play: fair and fun. Oddball: anyone can throw guesses.
