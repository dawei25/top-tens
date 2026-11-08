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
      - **stadiums:** Camp Nou: revisit when the renovation completes (2028-29). The article gives 62,652 while
        stands reopen in phases and 105,000 only as expected; the list keeps 99,354 (#12).
      - Sources still missing: 2025 sales for BMW, Mercedes and Tesla; career points for active NBA stars; Facebook
        follower counts; a deeper city-visitors ranking; 2025 theme-park figures.

- [ ] **`normalize()` and leading "A"** (contract change, needs a full rebuild): "A-Rod" normalizes to "rod"
      because the leading article is dropped, so that alias also catches "rod". Only drop "a" when a word follows it
      with a space, or keep hyphenated forms whole.

- [ ] **europe-population, from Nov 4:** rebuild so it gets `region` and the out-of-region penalty like the other
      regional lists (it was today's daily on Nov 3, so it was only hand-patched then).

- [ ] **Topic ideas parked:** most valuable sports teams (Forbes 2025 ties at #10/#11, Bears and Yankees at $8.2B;
      the 2024 table has no tie but is a year older). Retry when Wikipedia has the 2026 list. Best-selling book
      series (five series tie at #10 with 200 million each). Countries with the most Starbucks stores (owner's pick,
      Nov 5): Wikipedia has no stores-by-country table (no "List of countries with Starbucks stores"; the Starbucks
      article gives totals only).

- [ ] **Junk alias:** "How Bout Dem Cowboys" on the Dallas Cowboys (super-bowl-wins).

- [ ] **Nov 5 pipeline changes not yet on every list** (apply at each list's next rebuild): CITY_JUNK in
      scripts/aliases.ts now holds the city redirects judges found on one city list (schools, clubs, districts,
      demonyms), dropped on every city list; COUNTRY_FORMS gives "St Kitts", "St Vincent", "St Lucia", "Antigua" and
      their other forms to every country list; a universe member merges into the entry its usual name already names
      (tourism's second "Macao" goes; validate.ts only warns on it until then).

- [ ] **Cycle 4 pipeline changes not yet on every list** (apply at each list's next rebuild): "Science in Aotearoa"
      in the shared country junk list (13 country lists); infobox values never replace a stat from a table (lists
      using `values`).

- [ ] **Coverage audit (Nov 8) fixes for the protected lists, after Nov 10 16:00 HKT.** The code is in (data agent
      B); only the rebuild of these four is left. Add each guard to scripts/aliases.test.ts once built.
      - **languages:** intent.ts gives Indonesian "Bahasa" ("bahasa" was corrected to Bengali), Standard German
        "Deutsch" and Yue Chinese "Yue" (both found nothing). Guards: "bahasa" → Indonesian, "deutsch" → Standard
        German, "yue" → Yue Chinese. Still open, a source for agent A: the ranked table stops near #38, so Polish,
        Dutch, Greek and 60 more well-known languages are unknown, and Sindhi, Catalan and Aramaic are corrected
        into Hindi, Spanish and Arabic. **Fix (agent A, not built):** add
        `{ page: "List of ISO 639 language codes", tables: [0], name: "ISO language names", nameFromLink: true,
        nameStrip: / language$/ }` to `also` (cached; 183 languages with ISO 639-1 codes: Polish, Dutch, Greek,
        Hebrew, Malay, Nepali, Welsh, Zulu, Latin, Catalan, Sindhi, Malayalam; the link gives "Catalan language" for
        "Catalan, Valencian", so `nameStrip` leaves "Catalan"; `also` takes `nameStrip` since Nov 8). Aramaic has no
        639-1 code: `more: { Aramaic: [] }`. Guards: "polish", "malayalam" → their entries, "sindhi" not Hindi.
      - **music-artists:** intent.ts gives Kanye West "Ye" (his legal name); knownNames "6ix9ine" (read as junk).
        Guards: "ye" → Kanye West, "6ix9ine" not junk. Still open: today's chart artists (BTS, Bad Bunny, Billie
        Eilish, Kendrick Lamar...) need an `also` such as "List of most-streamed artists on Spotify". **Fix (agent
        A, not built):** `also` from that page (cached), as spotify-artists reads it: tables [4, 5] by "Artist", the
        yearly top fives (table 0, columns 1-5) and monthly number ones (table 6, columns 1-12); plus spotify-artists'
        hand list (`more`: Morgan Wallen, Sabrina Carpenter, Chappell Roan, Peso Pluma...) and boy bands and girl
        groups by hand (One Direction, NSYNC, TLC). Guards: "bts", "bad bunny", "billie eilish" → their entries.
      - **coffee-countries:** the new COUNTRY_FORMS lines (Columbia, Brasil, Guatamala, Lichtenstein...) apply.
      - **canada-cities:** the new CITY_FORMS lines apply. Still open: provincial and territorial capitals below the
        top 100 (Charlottetown, Whitehorse, Yellowknife) need an `also` source. **Fix (agent A, not built):** no
        capitals table exists ("List of Canadian provincial and territorial capital cities" is no article); add
        `more: { Charlottetown: [], Whitehorse: [], Yellowknife: [], Iqaluit: [] }` (unranked, no figure).

- [ ] **Coverage audit (Nov 8) shared forms on agent A's lists** (apply at each list's next rebuild): COUNTRY_FORMS
      (Columbia, Lichtenstein, Afganistan, Guatamala, Lybia, Kazakstan, Phillipines, Brasil, Republic of Congo, and
      Northern Ireland as the United Kingdom) on billionaire-countries, nobel-countries, gdp-per-capita,
      mcdonalds-countries, landlocked-countries, world-heritage-countries and islands; CITY_FORMS (India's renamed
      cities, China's postal spellings, Europe's own names, US nicknames) on skyscraper-cities.

- [ ] **Nov 8 pipeline changes (data agent A) not yet on every list** (apply at each list's next rebuild):
      - **Merging:** junk aliases no longer count as taken names, and a short form cut from either name never merges
        two rows that link different articles (`shortFormOnly`); a row of an entry's own name is that entry. Before
        it, films-gross had lost 19 films (The Phantom Menace, Spider-Man 3, The Two Towers), animated-films Mugen
        Train, islands China (into Taiwan through its junk "China"). Every list with `also` or categories can gain
        entries it had swallowed: diff each rebuild (a redirect-titled link can split one thing in two, as "Rogue
        One" did: `skip` the short row).
      - **Spellings:** every name with Mecca or Medina gets its other spellings (Makkah, Mekka...), and names with
        letters accents don't cover get a keyboard spelling (Solskjaer, Odegaard, Gudjohnsen, Gross), with the
        surname on lists of people (build.ts SPELLINGS, FOLDS).
      - **Category caps:** a category that fills its cap warns. Still capped, needing `categoryCap` and a rebuild:
        mountains ("Mountains of the Alps", 3,000) and youtube-channels ("YouTubers", 3,000).
      - New options used so far only on their lists: `also.counts` (skyscraper-cities), `also.nameStrip`
        (companies-revenue), `Dated.largest` (video-games), `countryCol` (islands; the matcher reads `country`).

- [ ] **`normalize()` and ø, æ, ð, þ, ł, đ, œ, ß** (contract change, needs a full rebuild): accent-stripping leaves
      them, so "odegaard" never meets Ødegaard. The build now adds keyboard spellings as aliases (FOLDS); folding
      them in `normalize()` itself would cover every typed form and make FOLDS unnecessary.

- [ ] **Coverage audit leftovers on agent A's free-play lists** (no rebuild needed until fixed):
      - **girls-names, boys-names:** today's top names (Liam, Noah, Olivia, Sophia) and the century's top 100 need
        a source with figures (the page has the century's top 50 only); nicknames (Mike, Bob, Liz) want a matcher
        rule that offers the full name to confirm, not a silent alias.
      - **netflix-seasons:** The Queen's Gambit, The Night Agent and Fool Me Once need a sourced views figure (`cited`)
        from their articles; the other Netflix series are free known names already, only their message is left.
      - Messages (UI/matcher): known names and `skip`ped rows still read "Not one of the N ... here" (cable shows on
        longest-running-tv, Manila on skyscraper-cities, past stars on athletes-earnings, palaces on museums); sport
        words on sports-leagues ("basketball") and kinds of product on farm-products ("meat") want the subject-word
        rule; "88888888" on passwords reads as junk; "a-league" normalizes to "league" (the leading-"A" item above).

- [ ] **Cycle 3 pipeline changes not yet on every list** (apply at each list's next rebuild): intent groups wait for
      all their entries, `stripWords` patterns, short forms ending in a little word dropped, new athletes' junk in
      the shared celebrity list and their cached redirects. Also: the French billionaires table links Tanya Saadé
      Zeenny to Jacques Saadé Jr.'s article, so they merge into one entry on richest-people.

## Done

- **Cycle 3** (2026-11-02): richest-people near misses take the newest figure from the US, India and France
  rankings (world ranks 11+ don't exist on Wikipedia); x-accounts, facebook-pages and tiktok-accounts rebuilt with
  the shared celebrity junk list; plain words decided by the lexicon (pool names no longer veto, except words of an
  entry with a figure).
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
