# Top Tens

A browser game: a category is shown ("Most populous countries"), the player names the top 10, 5 lives.
Static site (Vite + React + TypeScript), no backend. Puzzles are prebuilt from Wikipedia into JSON.

Read `docs/DESIGN.md` for the rules of the game and the visual direction.

Changes that need a full puzzle rebuild are batched in `docs/REBUILD_QUEUE.md`: add to it instead of rebuilding.

## Layout

| Path | What | Owner |
|---|---|---|
| `src/components/`, `src/App.tsx`, `src/index.css`, `index.html` | UI: layout, buttons, behavior | frontend agent |
| `src/motion.css`, `src/components/motion/` | Animations (may add classes/data attributes to UI markup, never restructure it) | animations agent |
| `e2e/` | Browser test suite | frontend agent |
| `scripts/`, `public/puzzles/` | Wikipedia → puzzle JSON pipeline and its output | data agent |
| `src/game/` | Game rules, answer matching, puzzle format, storage | coordinator (main session) |
| `CLAUDE.md`, `docs/`, `package.json`, configs | Shared | coordinator |

## Parallel agent rules

Several agents work on this repo at the same time, each in its own git worktree and branch.

- Edit only the paths you own. If you need a change in `src/game/` or a shared file, stop and describe the change
  you need in your final report instead of making it. `src/game/types.ts` (the puzzle format) and `normalize()` in
  `src/game/match.ts` are a contract between the pipeline and the UI; changing either one means rebuilding every puzzle.
- Commit only to your own branch. Never merge, rebase onto, or push `main`; the coordinator reviews and merges.
- Commit in small steps with clear messages. End commit messages with the attribution lines your session gives you.
- Never run `git push` and never create pull requests.
- Use your own local port for any dev or preview server, so agents don't collide:
  coordinator 5100, frontend 5101, data 5102. Each Playwright `chromium.launch()` is already its own browser.
- Write scratch files (screenshots, logs, test scripts) in your session's scratchpad directory, not in the repo.

## Setup in a fresh worktree

```bash
npm ci
```

The data agent also needs the Wikipedia cache (gitignored, about 10 minutes and hundreds of requests to rebuild):

```bash
cp -r /home/user/top-tens/.cache .
```

## Commands

```bash
npm test                     # vitest: matcher, game state, junk detector, checks on the built puzzles
npx tsc -p tsconfig.app.json --noEmit
npx vite build               # production build into dist/
npx vite --port <your port>  # dev server
npm run build:test           # rebuild only the 10-list test set (TEST_SET in scripts/topics.ts) and index just those
npm run build:puzzles        # rebuild every puzzle + lexicon.json (append topic ids to rebuild only those)
npm run inspect -- "List of ..."   # print a Wikipedia page's tables, for writing new topics
```

Before reporting done: `npm test`, the typecheck and `npx vite build` all pass.

## Browser checks (keep them lean)

- The maintained browser suite lives in `e2e/` and runs with `npm run e2e` (once it exists). It selects elements by
  `data-testid` and aria labels, never by visible text or layout, so design changes don't break it. If you change a
  flow it covers, update the suite in the same change.
- For a new feature: run the suite, plus a few targeted checks of the new behavior. Don't re-run or report old
  throwaway scripts from earlier tasks; delete them.
- Screenshots: only what the coordinator needs to review the change (typically 2 to 4: phone and desktop).
- Report test results briefly: what passed, and any real failure with its cause. Not every check.

## Wikipedia etiquette

The build reads normal page HTML (the API is rate-limited from this container), waits 1.5 s between requests and
caches every response in `.cache/wiki`. Keep it that way: never lower the delay or fetch in parallel. Ranks 11+ only
use redirects already in the cache.

## Data rules (pipeline)

- Every row of a topic's source table is an accepted answer. Only accepted answers outside the top 10 cost a life;
  anything else is free. So answer sets should be broad: country lists also include every country.
- A topic whose #10 and #11 tie is rejected.
- Aliases come from Wikipedia redirects, short forms and `scripts/intent.ts`. An alias shared by 2-4 entries is kept
  on all of them (the game offers the choices); more owners than that, and it is dropped.
- `NODE_NO_WARNINGS=1 npx tsx scripts/validate.ts` checks every built puzzle; run it after a rebuild.

## Writing

UI copy: short, plain, a little dry. No em dashes, no emoji in game copy.
