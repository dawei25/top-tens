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

## What good looks like

- Titles say what the player is naming; misses say how many of what the list holds.
- Every obvious guess either scores with a rank and figure or is honestly outside the source.
- Matching reads guesses the natural way (CLAUDE.md, docs/DESIGN.md §2): partial knowledge helps, unrelated words
  never become answers.
- Dailies: a typical player averages 5 to 6. Free play: fair and fun. Oddball: anyone can throw guesses.
