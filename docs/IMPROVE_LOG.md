# Improvement log

Newest first. One entry per cycle of the loop in `docs/IMPROVE.md`.

## 2026-11-02, cycle 3

- Judged: instagram (free play, Blitz-ready: the casual found 10/10, too easy for a list, a great Blitz),
  music-artists (fix-first again: the title still said "sales"; now "most certified sales and streams", re-judge
  next), concert-tours (fix-first: aliases, artist + tour readings, figures for misses; all fixed, re-judge next,
  likely a daily), richest-people (free play: the casual found 9; misses now show the newest US, India or France
  figure, since world ranks past #10 aren't on Wikipedia).
- Schedule: Nov 4's Blitz was Broadway, Nov 2's list, frozen before the no-repeat rule; now beer-per-capita. Builder
  verdicts (`"by": "builder"`) no longer schedule (instagram almost ran on one). Test: no list runs twice from Nov 2.
  Scheduled through Nov 12, so no top-up.
- Matcher: an artist with several entries lets the rest of the guess pick ("ed sheeran divide"); a name's words in
  order with some left out read as that name ("renaissance tour", "lord rings", "harry potter stone"); the lexicon
  alone decides plain words.
- Data: plain words no longer vetoed by obscure pool names, except words of an entry with a figure (the strict rule
  lost 139 readings with figures for 11 fewer leaks); x-accounts, facebook-pages and tiktok-accounts rebuilt with the
  shared junk list; concert-tours aliases ("the weekend", "m72", "farewell tour" to Elton) and dated figures from
  yearly tables; 2Pac and RiRi.
- Leak rate: 1.6% before this cycle; re-measure on the merged main pending.
- New topics: athletes-earnings ("Highest-earning athletes of 2026", every Forbes top 10 since 2012 accepted with its
  year; casual 8, par 6) and car-models ("Best-selling car models of all time"; casual 7, Blitz 15/23). Both need a
  judge. Known cost on car-models: "gold" is corrected to Golf.
- Method: cache merges newer-wins (a stale Instagram page nearly brought back a #10/#11 tie); intent groups wait for
  all their entries; one-row-per-year tables get dated labels.
- Next: judge athletes-earnings, car-models, concert-tours and music-artists (both fixed); typo corrections of plain
  English words ("gold" to Golf, "rice" to Nice) are now the biggest leak class.

## 2026-11-02, cycle 2

- Judged: capitals (daily list, p8, also Blitz), animated-films (daily list, p8, also Blitz), theme-parks (daily
  list, p7), music-artists (fix-first: "best-selling" title over a certified-units ranking, so the Beatles, Elvis
  and Madonna cost lives; retitled and rebuilt, re-judge next). Daily bank: 6 approved lists not yet scheduled;
  scheduled through Nov 12, so no top-up.
- Data: all four lists' fixes (capitals merged with their other spellings, theme-park category pages skipped,
  gross figures for every unranked animated film); ties below the top 10 share a rank (Everland #20).
- Method fixes: plain words in the lexicon (5,408), never the words top-10 answers or ranked people are known by
  (the spec as written lost 243 natural readings, "cowboys", "pizza", "swift"); shared junk lists for companies and
  celebrities; an alias made of two names joined by a comma is dropped; validate.ts warns on one place under two
  names; judge brief: the title names an unexpected measure.
- Matcher: number words count as digits ("frozen two"); a guess that is a name of its own isn't read as an answer
  plus who made it ("saudi aramco" is not Saudi Arabia).
- Leak rate: 2.7% -> 1.6% (1377 of 86,645 wrong guesses, 93 lists). Most of the drop is the "saudi aramco" rule
  (about 21 country lists); plain words alone took it to 2.5%. Worst left: theme-parks, stadiums, youtube-channels,
  video-games ("planes", "water", "humans", "music"), which the narrower known-name rule should cut.
- New topics: instagram (most-followed accounts; casual 8, Blitz 26/29; could be a daily, needs a judge) and
  fiction-authors (ranked by the low estimate, ties broken by the high; casual 4, free play).
- Next: judge instagram, concert-tours and music-artists; the narrower known-name rule for plain words
  (REBUILD_QUEUE); rebuild x-accounts, facebook-pages and tiktok-accounts for the shared junk list.

## 2026-11-02, par model fixed (player feedback, second round)

- The uniform shift after "par too high" pushed hard lists to absurd pars (city visitors par 1; a player who got 5
  was "top 10%"). Replaced with a compressed model: the typical player is 1.5 + 0.45 x the judge's casual score, so
  pars run 3-7 instead of 0-7 (city visitors 4, stadiums 3, countries by population 7, Nov 5-12 dailies 5-6).
- Daily bar back to the casual finding 6 to 8 (estimated average 5 to 6).
- Lesson: one simulated run per list plus a global offset is too crude to shift by hand; real scores (Phase 1) are
  the fix.

## 2026-11-02, cycle 1

- Judged: market-cap-peak (daily list), youtube-videos (daily list), car-makers (daily list), theme-parks (fix-first:
  the disney gap and non-park pages, now fixed; re-judge next). Three days added to the daily bank.
- Method fixes: "Total" rows only skipped as a whole word (TotalEnergies, Total War back); same-title works kept apart
  by year (both Lion Kings); ~150 demonyms on country lists ("american" is the US); per-row value overrides; former
  countries in the lexicon ("prussia" is not Russia); facts must survive renames (pending, see below).
- Data: fixes for 39 lists, including every Nov 5-12 daily and Blitz; capitals (Dhaka 2022, only capitals count) and
  theme parks ready for re-judging.
- Matcher: an answer's name followed by who made it ("perfect ed sheeran") asks for that answer.
- New topics: music-artists (Drake #1, the Beatles #11; casual 7, Blitz 29/30) and concert-tours (casual 7); both
  need a judge. Dropped: World Heritage Sites by country (no parseable table).
- Found by a player: 94 top-10 answers had no fact (all Oddball lists, renames). Facts agent writing them; build to
  match facts by normalized name and the validator to flag a top-10 answer without one.
- Next: re-judge theme-parks, capitals, animated-films, music-artists, concert-tours and the "too easy" 9s under the
  new par calibration; "bookworm" still finds Amazon on companies-revenue.

## 2026-11-02, par recalibrated (player feedback)

- Real players said par read too high. The synthetic crowd now sits about 2.6 answers under the judge's casual player
  (was 1.2): pars mostly 4-5 instead of 6-8; the scheduled Nov 5-12 dailies are all par 5 (est. averages 4.5-5.4).
- Daily-list bar moved with it: the casual finds 7 to 9, ideally 8 (was 6 to 8). Lists judged "too easy" at 9 since
  Nov 2 (Nobel countries) and older 9s (Ballon d'Or, F1 wins, richest people, Super Bowl wins) should be re-judged.
- The real fix is real data: Phase 1 score stats replace the estimate once a list has 50 players.

## 2026-11-02 (before the loop)

- Quality pass and full rebuild: titles name the answer type, nouns, parse fixes (Titanic's figure, China cities to
  452), abbreviations, all 23 fix-first lists, slur blocklist, moons in Science.
- 19 lists re-judged to the one-topic, 5-6 bar: 8 daily, 2 fix-first (capitals, animated films), 9 free play.
  Dailies scheduled through Nov 12.
- Matcher: natural reading for several fits, partial names confirm first, no whole-word typos, no category-word
  corrections. Leak audit (strict) 1.3% → 0.5% before the generosity change.
- Oddball category: 5 lists shipped (fast food chains by locations, US surnames, tea per person, girls' names,
  passwords), each kept only after a casual guess run found 4+. Then beer per person and boys' names added
  back at David's call (Oddball is free play: hard-but-fun and easy both belong). Dropped: fastest animals (birds),
  dog breeds (no data past 10).
