# Improvement log

Newest first. One entry per cycle of the loop in `docs/IMPROVE.md`.

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
