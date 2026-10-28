# Top Tens: design plan

Working name. A browser game: you get a category ("Most populous countries"), you name the top 10, and you have 5 lives.

## 1. Core rules

- 10 hidden slots, ordered by rank. Each correct guess reveals its slot (rank, name, source value).
- 5 lives. A life is lost only for a **wrong guess**:
  - **Near miss** (the answer exists in the source list but ranks 11+): lose a life, but show "#14, close" so the guess still teaches something.
  - **Wrong** (nothing close in the list): lose a life.
- No life lost for:
  - **Misspellings**: close typos autocorrect to the right answer ("Bangladesch" counts as Bangladesh, with a small "counted as" note).
  - **Ambiguous or far typos**: "Irak" (Iran or Iraq?) or "Packeestan" gets a "check your spelling" shake plus suggestions, no penalty.
  - **Duplicates**: "already got that".
- The game ends at 10/10 or 0 lives. On a loss, the missing slots are revealed in a different color.
- Optional give up button, which reveals everything.

## 2. Answer matching (built: `src/game/match.ts`)

1. Normalize: lowercase, strip accents and punctuation, `&` becomes `and`, drop a leading "the/a/an".
2. Exact match against the name plus aliases (`USA`, `America`, `PRC`, ...).
3. Fuzzy match with the optimal-string-alignment distance (Levenshtein plus swapped letters). The autocorrect budget scales with word length: 0 edits for 3 letters or fewer, 1 for up to 5, 2 for up to 10, 3 above that.
4. If two entries tie, ask instead of guessing.
5. One edit beyond the budget is a "typo" (no penalty). Anything further away counts as wrong.

The candidate set is the top 10 **plus ranks 11+ from the same table**. Including those extra ranks is what lets us tell "real but wrong" apart from "misspelled", and it keeps "Niger" from autocorrecting to "Nigeria".

## 3. Content: rolled from Wikipedia

The game's random roll draws from a bank of puzzles prebuilt from Wikipedia. Wikipedia is not scraped live in the browser, because table parsing is fragile and slow, and a broken table would ship a broken puzzle to players.

```
data/topics.ts       hand-written catalog: wiki page, which table, name column, value column, prompt
scripts/build.ts     for each topic:
                       1. fetch page HTML via the MediaWiki parse API
                       2. parse the target table, take rows in rank order (top ~50)
                       3. read each row's linked article title (the canonical name)
                       4. batch-query Wikipedia redirects for each title, which become aliases
                          ("USA", "U.S.", "America" all redirect to United States)
                       5. add surname aliases for people when unique ("Messi")
                       6. write public/puzzles/<id>.json with source URL + revision date
public/puzzles/index.json   list of puzzle ids + titles + categories
```

- **Roll mode:** pick a random unplayed puzzle, optionally filtered by category (Geography, Sports, Music, Film, Business, ...).
- **Daily mode:** a date-seeded pick, so everyone gets the same puzzle each day. Shareable.
- Every puzzle shows its source link and "as of" date. Accuracy only needs to be generally right, but showing the source is a cheap way to settle arguments.
- The catalog grows by adding a few lines per topic. Wikipedia redirects give us aliases mostly for free.

Data shape: see `src/game/types.ts` (`Puzzle`, `Entry`).

## 4. Screens

1. **Home**: "Daily" and "Roll a random one" buttons, category chips, streak.
2. **Game**: category prompt at top, lives indicator, 10 rank slots, input pinned near the bottom (mobile keyboard friendly), feedback toast/shake for each guess.
3. **Results**: score (x/10), lives left, the full list with values, source link, share button (emoji grid style), "Roll another".
4. **How to play** modal on first visit. **Stats** modal (played, win %, streak, distribution of x/10).

## 5. Visual design

**Blocked**: the plan is to match Krillion's look and feel, but this cloud session's network policy blocks krillion.cc, listabledaily.com and Wikipedia. The teardown (palette, type, spacing, motion, share card) gets filled in here once access is allowed.

Placeholders until then: single centered column (max ~520px), large type for the prompt, slots as cards that flip on reveal, a satisfying correct/wrong micro-animation, light and dark themes driven by CSS tokens.

## 6. Tech

- Vite + React + TypeScript, Vitest for tests. Static site, no backend.
- Stats, streaks and in-progress games live in `localStorage`.
- Hosting: GitHub Pages or Vercel from the GitHub repo. (Pages on a free account needs a public repo.)

## 7. Build order

1. ~~Project scaffold, matcher + tests~~
2. Data pipeline + first ~30 topics (needs Wikipedia access)
3. Game screen with real puzzles, unstyled
4. Krillion-inspired visual pass (needs krillion.cc access)
5. Results/share, stats, daily mode
6. Deploy

## Open questions

- Name of the game.
- Should finding the lower ranks (#8-10) score more, or is it a flat x/10?
- Show the source values (e.g. population numbers) during play, or only on reveal?
