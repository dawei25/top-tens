# Rebuild queue

Changes that need a full `npm run build:puzzles`. Batch them: do the code/data work, tick it here, and run one
rebuild when the batch is ready (then `scripts/validate.ts`, `npm test`, commit `public/puzzles`, republish).

Pure UI or matcher changes don't belong here; they ship without a rebuild.

**Test phase:** iterate with `npm run build:test` (10 lists, under a minute from cache). Items marked "test set"
are live on those 10 only; a full `npm run build:puzzles` before launch applies everything to all 82.

## Pending

- [x] **Values for unranked answers** (test set: mountains, islands, nba-points, youtube-channels, airports; `scripts/likely.ts`, `scripts/values.ts`). A miss on an unranked pool entry (rank 0) can't show its number, e.g.
      "Klein Matterhorn isn't in the top 10" instead of its height, because universes and categories only give
      names. (a) Carry the value from `also` tables that have the topic's metric column (cheap). (b) Optional,
      owner to decide: read the value from each pool entry's article infobox (height, population, area...). All
      ~25,000 pool entries is ~10 h of fetching at 1.5 s; capped at the ~300 likeliest per topic, ~75 min.
      The UI already shows `value` for rank-0 entries when present.
- [ ] **Wrong source articles.** CITIC Tower (buildings) resolves to a 33-storey Hong Kong office block and Arctic
      Desert (deserts) to a small WWF ecoregion; both entries' redirects/aliases and facts come from the wrong page.
      Fix `redirectTarget` for them (topic `aliases`/article override), then write their facts.
- [x] **Per-table data date** (test set; code done in `scripts/dates.ts`: an "as of" date in the caption or nearby text,
      a month and year in the caption, or a year in the value header; applies at the rebuild).
- [x] **Fun facts** (test set rewritten for fun with full articles and Did-you-know hooks; the other 72 lists still have
      the first-pass facts and need the same rewrite; 796 written and reviewed in `scripts/facts/`; they reach the game at the rebuild).

- [x] **Clearer metric labels** (test set; "Sales (millions)" is now "Copies sold (millions)", box office and
      money labels say US$; 12 labels across the 82 lists).

## Done

(none yet)
