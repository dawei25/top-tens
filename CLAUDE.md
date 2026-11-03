# TENtacle (formerly Top Tens)

A browser game (TENtacle): a category is shown ("Most populous countries"), the player names the top 10, 5 lives.
Static site (Vite + React + TypeScript), no backend. Puzzles are prebuilt from Wikipedia into JSON.

Read `docs/DESIGN.md` for the rules of the game and the visual direction, and `docs/UX.md` (the owner's UX principles,
learned from his feedback) before any UI change.

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
npm run verify               # everything below, then the browser suite: the definition of done
npm run verify:deploy        # what Vercel runs: src unit tests, typecheck, lint:css, build (no browser, no .cache)
npm run lint:css             # no layout properties in hover/focus/press rules (exceptions need a reason comment)
E2E_PORT=<port> npm run e2e  # browser suite; `npm run e2e -- <words>` runs only matching specs
UPDATE_BASELINES=1 npm run e2e -- visual   # rewrite the visual baselines (review every changed image)
STATES_ALL=1 npm run e2e -- states         # the interaction-state walk over every element, not two of each kind
```

## Making a change (definition of done)

A change is done when `npm run verify` passes in your worktree. It runs, stopping at the first failure: unit tests,
the typecheck, oxlint, the CSS state check (`npm run lint:css`), the build, and the whole browser suite (behavior,
the interaction-state layout check, visual baselines). Data agents run `validate.ts` and `par.ts` before it.

**UI changes** (anything under `src/components/`, `src/*.css`, `index.html`) also:

- Follow the UI rules in `docs/DESIGN.md` §5a: hover, focus and press never move or resize anything; nothing means
  something only on hover; phone first.
- Check every state you touched (rest, hover, keyboard focus, pressed, disabled, played) at phone 390 and desktop
  1440, not only the rest state.
- Visual baselines (`e2e/baselines/`) are the reference. A changed baseline is either a bug to fix or the change you
  meant: re-baseline only the images your change was meant to alter (`UPDATE_BASELINES=1 npm run e2e`) and list each
  in your report with the reason.
- Screenshots for review: 2 to 4, phone and desktop, including the hover or focus state of what you changed.

**Every bug gets a guard, written first:** a test, a check or a documented rule that fails on the bug, then the fix
that makes it pass. Record it in the bug→guard table in `docs/IMPROVE.md`, so the class can't come back.

**The coordinator** merges only after `npm run verify` passes on the merged main, looks at every changed baseline
(before, after and diff), and then pushes. Vercel's build runs `npm run verify:deploy` (unit tests, typecheck, CSS
check, build), so a failing check stops the deploy and the last good version stays live.

## Browser checks

- The browser suite lives in `e2e/` and runs with `npm run e2e`. It selects elements by `data-testid` and aria
  labels, never by visible text or layout, so copy changes don't break it. If you change a flow it covers, update
  the suite in the same change.
- For a new feature: the suite, plus a few targeted checks of the new behavior. Don't re-run or report old throwaway
  scripts from earlier tasks; delete them.
- Report test results briefly: what passed, and any real failure with its cause. Not every check.

## Wikipedia etiquette

The build reads normal page HTML (the API is rate-limited from this container), waits 1.5 s between requests and
caches every response in `.cache/wiki`. Keep it that way: never lower the delay or fetch in parallel. Ranks 11+ only
use redirects already in the cache.

## Data rules (pipeline)

- Every row of a topic's source table is an accepted answer. Only accepted answers outside the top 10 cost a life;
  anything else is free. So answer sets should be broad: country lists also include every country.
- Regional geography lists (`region` in topics.ts: a continent or a country) take their answers from their region.
  A place outside it costs a life and says so ("Tokyo isn't in Europe.": `elsewhere`, owner's call: it's on the
  player); places on two continents that the source leaves out stay free. validate.ts enforces both.
- A topic whose #10 and #11 tie is rejected.
- Aliases come from Wikipedia redirects, short forms and `scripts/intent.ts`. An alias shared by 2-4 entries is kept
  on all of them; more owners than that, and it is dropped.
- Matching follows the natural reading (`src/game/match.ts`): when several answers fit what was typed, the most
  prominent one comes first ("jordan" is Michael Jordan; DeAndre Jordan once MJ is found), and partial knowledge
  helps ("shenzhen", "avengers" offer options). But an unrelated word is never turned into an answer ("pope" is not
  "Don't Bother Me, I Can't Cope", "islands" is not Ireland). Aliases must not undo that: no generic English words
  as aliases.
- Every top-10 answer needs a fun fact (`scripts/facts/<id>.json`, with a source), and misses should show a number:
  when the ranked table stops early, unranked answers take dated figures from the page's other tables.
- Every bug a player reports gets a guard (a validate.ts check, a test or a judge-brief line), recorded in
  `docs/IMPROVE.md`, so the class can't come back.
- `NODE_NO_WARNINGS=1 npx tsx scripts/validate.ts` checks every built puzzle; run it after a rebuild.

## Writing

UI copy: short, plain, a little dry. No em dashes, no emoji in game copy.
