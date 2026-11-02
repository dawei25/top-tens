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
   `validate.ts` and `scripts/judge/par.ts`.
4. **Coordinator:** matcher findings in `src/game/match.ts` with unit tests; the leak audit (wrong guesses that get
   an answer offered); review the data branch; merge; `npm test`, typecheck, build, e2e; push main (it deploys).
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
| Singapore, Tokyo, NYC "isn't in the top 10" with no figure | misses with no number when the source ranks only 10 | unranked answers take figures (with year) from the page's other tables; validate.ts flags lists whose misses can't show a figure |
| Par read too high | the synthetic crowd too strong | crowd recalibrated; real stats (Phase 1) replace it |

## What good looks like

- Titles say what the player is naming; misses say how many of what the list holds.
- Every obvious guess either scores with a rank and figure or is honestly outside the source, and an obvious miss
  shows a number (a rank, or a dated figure from the page) wherever the source has one.
- Every top-10 answer has a fun fact with a source.
- Matching reads guesses the natural way (CLAUDE.md, docs/DESIGN.md §2): partial knowledge helps, unrelated words
  never become answers.
- Dailies: a typical player averages 5 to 6. Free play: fair and fun. Oddball: anyone can throw guesses.
