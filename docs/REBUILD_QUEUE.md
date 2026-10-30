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

- [x] **Blitz stats** (test set: `n` per entry in the list's unit, `blitz` flag, `lowerIsBetter` on websites; all 82
      lists need the rebuild).

- [ ] **List judge fixes** (from `scripts/judge/verdicts/*.json`, `fixes` arrays; re-judge each list after the rebuild).
      Pipeline-wide, worth a check in `validate.ts`:
      - **Junk aliases:** redirects that aren't names of the thing ("1937 Nanga Parbat tragedy", "Child abuse in
        Saudi Arabia", "Timeline of WhatsApp", "Yellowstone Act", song and character names on musicals and books).
        Drop "X in/of <name>" shaped redirects and event/topic articles.
      - **Glued aliases:** alias text concatenated without spaces ("Mount EverestSagarmathaChomolungma", 18 on
        mountains).
      - **Bare-word aliases that cost a life:** "australia" for Stadium Australia, "salt" for Salt Lake Stadium,
        "karl" from split family rows on richest-people, "City" on US states.
      - **Duplicates:** Republic of the Congo appears twice on oil-production.
      - **Missing category** in the built JSON (websites, countries-gdp); `topics.ts` has it.
      Per list:
      - **us-states-area: wrong values.** The km² column has dots as thousands separators for Nevada ("382.936"),
        Idaho and Florida, so Nevada drops out of the top 10 and Idaho takes #7. Read the square-mile column (or
        parse the separator), and add a validator check: a km²/mi² ratio far from 2.59 or a "nnn.nnn" value.
      - **richest-people:** add ranks 11-25 (Forbes) so famous near misses show a rank; drop the "American
        billionaires" category (Taylor Swift and Oprah cost a life, non-Americans are free); fix Bettencourt
        (Françoise Bettencourt Meyers isn't recognized; "bettencourt" hits the late Liliane).
      - **books:** say in the prompt that religious, political and multi-volume works are excluded; drop the
        "Novels adapted into films" category; fix one garbled Japanese title.
      - **stadiums:** college team names (LSU, Ohio State, Alabama) and MCG / Nou Camp / Bernabeu aliases; check
        Camp Nou's post-renovation capacity. As a daily it needs a reframed prompt.
      - **mountains:** Denali needs the McKinley alias; Mount Fuji has no height; non-mountains ("Death zone",
        "Seven Summits", "Goûter Hut") cost a life.
      - **websites:** the extra categories pull in non-websites ("discord" offers "Clearinghouse for Networked
        Information Discovery and Retrieval").
      - **Small aliases:** "s korea" (countries-gdp), "rocky mtn" (national-parks), postal codes NM/NV/CO/OR/MT
        (us-states-area).

## Done

- **Matcher: shared words aren't typo evidence** (code, no rebuild). "mount whitney" was corrected to Mount Lhotse
  (an alias of Lhotse) because "mount " fit inside the typo budget; now only the differing words are compared.
