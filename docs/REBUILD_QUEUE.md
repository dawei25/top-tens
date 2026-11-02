# Rebuild queue

Changes that need a full `npm run build:puzzles`. Batch them: do the code/data work, tick it here, and run one
rebuild when the batch is ready (then `scripts/validate.ts`, `npm test`, commit `public/puzzles`, republish).

Pure UI or matcher changes don't belong here; they ship without a rebuild.

**Test phase:** iterate with `npm run build:test` (10 lists, under a minute from cache). Items marked "test set"
are live on those 10 only; a full `npm run build:puzzles` before launch applies everything to all 82.

## Pending

- [ ] **Fun facts for the other 72 lists.** The test set's facts were rewritten for fun with full articles and
      Did-you-know hooks; the other 72 lists still have the first-pass facts and need the same rewrite (coordinator,
      only for lists judged daily-worthy). Antarctic Desert has no fact yet.

- [ ] **List judge leftovers** (re-judge each list after the rebuild):
      - **richest-people:** ranks 11-25 so famous near misses (Michael Dell, the Waltons, Bill Gates, Gautam Adani)
        show a rank. Needs a new source: The World's Billionaires table has only the top 10.
      - **stadiums:** Camp Nou's post-renovation capacity (the page still says 99,354; about 105,000 would make it
        #3).
      - Sources still missing: 2025 sales for BMW, Mercedes and Tesla; career points for active NBA stars; Facebook
        follower counts; a deeper city-visitors ranking; 2025 theme-park figures.

- [ ] **`normalize()` and leading "A"** (contract change, needs a full rebuild): "A-Rod" normalizes to "rod"
      because the leading article is dropped, so that alias also catches "rod". Only drop "a" when a word follows it
      with a space, or keep hyphenated forms whole.

- [ ] **Shared junk lists not yet applied** (cycle 2): x-accounts, facebook-pages and tiktok-accounts get
      `CELEBRITY_JUNK` and shared ranks for ties below the top 10 at their next rebuild (cached, no fetches).

- [ ] **Plain words, narrower "known name"** (lexicon + `isPlainWord`, cycle 3): `isPlainWord` vetoes any word that
      is the exact name of an obscure pool entry ("humans", "music"), so those still leak. Let the lexicon decide
      instead: count only ranked names and places as names when building `words` (about 670 more plain words), and
      drop the known-name check in `isPlainWord`. Measure with the leak audit and the plain-word test.

## Done

- **Matcher: "title artist" guesses** (2026-11-02): "perfect ed sheeran" puts Perfect in the box
  (`leadingName`), but not when the whole guess is a name of its own ("saudi aramco").
- **Quality pass and full rebuild** (2026-11-02): every title and prompt says what the player names, every puzzle
  has a `noun`; famous unranked answers get values from other tables on the page (Titanic $200 million, 43 more
  films; tourism, military spending, NHL points, Europe cities), China cities ranked to 452, 64 duplicates merged,
  23 famous peaks and infobox lengths for famous short rivers; abbreviations and short forms (SF, NYC, DRC, KSA,
  postal codes, GTA, CoD, LOTR, car brands, banks, airports by city, about 110 athlete nicknames); all 23 fix-first
  lists and the daily verdicts' fixes; a slur blocklist the validator enforces; moons in a new Science category;
  books, buildings and stadiums prompts. World Series and Super Bowl fall under the 30-figure Blitz minimum.
- **Full rebuild of all 82 lists** (2026-10-30), with everything below; `index.json` lists all 82, the daily
  schedule is unchanged. instagram still fails the #10/#11 tie rule and stays out.
- **Junk aliases** (`scripts/aliases.ts`, checked in `validate.ts`): "X in/of <name>" redirects, event, part and
  topic articles, years, descriptions, sort keys, parts named in a qualifier ("City (Alaska)"), and on works
  (books, shows, films, albums, songs, games, manga) redirects sharing no word with the title. About 4,750 redirects
  dropped, plus 137 listed by hand (`junkAliases`); 3,832 fewer aliases in all, 1,997 on top-10 entries.
- **Glued aliases:** table cells keep line breaks and list items apart (all ~20 on mountains gone).
- **Bare-word aliases:** one-word short forms that are plain words or places ("Salt", "Australia", "South") dropped;
  family rows give full names ("Karl Albrecht", not "Karl").
- **Duplicates:** a country row linking a country article (or "Petroleum industry in the Republic of the Congo")
  is that country; Congo is one entry on oil-production.
- **Category** (and `lowerIsBetter`) in every built JSON.
- **Misread numbers:** us-states-area km² cells that disagree with square miles × 2.59 take the converted value
  (Nevada #7, Idaho #14, Florida #22); the build warns on dot thousands separators and km²/mi² mismatches, the
  validator on "nnn.nnn" values and 20× jumps between ranked neighbours.
- **Wrong source articles:** CITIC Tower uses China Zun, Arctic Desert uses Arctic (topic `articles`); both have facts.
- **Per-list judge fixes:** postal codes on the state lists, "S. Korea", "Rocky Mtn", McKinley for Denali, Mount
  Fuji 3,776 m, stadium team names and MCG / Nou Camp / Bernabeu / AT&T aliases, books and richest-people lose their
  category pools, Bettencourt offers both, websites' categories keep names only, judge-listed junk dropped.
- **Values for unranked answers, per-table data dates, clearer metric labels, Blitz stats** (now on all 82 lists).

- **Matcher: shared words aren't typo evidence** (code, no rebuild). "mount whitney" was corrected to Mount Lhotse
  (an alias of Lhotse) because "mount " fit inside the typo budget; now only the differing words are compared.
