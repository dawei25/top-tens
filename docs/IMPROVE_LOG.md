# Improvement log

Newest first. One entry per cycle of the loop in `docs/IMPROVE.md`.

## 2026-11-22, weekly lineup (Dec 6 and the week of Dec 7), Sunday fallback

- No answer from the owner by Sunday 18:00 HKT (chat, doc comments or doc edits): scheduled as proposed. Sun Dec 6
  coldest-countries, Mon elements-crust, Tue gold-reserves, Wed languages-countries, Thu golf-countries, Fri
  high-capitals, Sat brands, Sun film-series: all debut lists, judged daily-list and audited (80 to 120 guesses each).
- Built Nov 20: 14 new lists in two rounds. Too easy for a daily, now free play and Blitz: world-cup-wins,
  car-countries, forest-countries. Spares: nuclear-countries, f1-wins-by-country (refresh after the Dec 6 finale),
  wikipedia-languages, populous-islands (fixed, needs a quick re-judge). Re-judged older lists: tourism,
  ballon-dor-countries and super-bowl-wins to free play (too easy); f1-wins-by-country stays daily.
- Legacy Blitz fields for the new days are free-play lists only: the scheduler had put two spare dailies there, which
  the run-once rule would have used up; swapped by hand for music-artists and rivers.

## 2026-11-22, launch-week morning check (Sun)

- Notes and ratings since yesterday's check: none. Plays all time: 189 across 91 lists (+1). Today's Fathom: 1
  player finished Fathom #7 yesterday (559), none yet on #8.
- Missed guesses: 2, one browser, both on yesterday's australia-cities and correctly refused: a misspelt New Zealand
  city and a state (the wrong-kind line is still the owner's call). No fix.

## 2026-11-21, launch-week morning check (Sat)

- Notes and ratings since yesterday's check: none. Plays all time: 188 across 90 lists (+3). Today's Fathom: 2
  players finished Fathom #6 yesterday (average 517), none yet on #7.
- Missed guesses: 2, one browser each, both correctly refused: a territory on happiest-countries (not a country) and a
  two-letter fragment on capitals. No fix.

## 2026-11-20, launch-week morning check (Fri)

- Notes, ratings and missed guesses since yesterday's check: none. Plays all time: 185 across 89 lists (+1). Today's
  Fathom: nobody finished Fathom #5 yesterday, none yet on #6.
- So quiet that the write path was checked: the live site serves the latest build (today's list, the city list's
  Pearl River Delta entry), and with every database call blocked (nothing written) a junk guess still tries
  submit_miss. The game is reporting; traffic is just low two days after the first post.

## 2026-11-19, launch-week morning check (Thu, the morning after the first post)

- Notes and ratings since yesterday's check: none. Plays all time: 184 across 88 lists (+10). Today's Fathom: 3
  players finished Fathom #4 yesterday (570, 650, 760; average 663), none yet on #5.
- Missed guesses: 14, one browser each, on 5 lists, typed between 13:22 and 23:03 HKT. Re-judged with today's
  matcher. Fair answers refused, fixed the same morning with guards (aliases.test.ts "missed guesses, Nov 18"; the
  lexicon kept as it was until Nov 20 so today's and tomorrow's dailies read exactly as before): four people-words on
  empires (English, Arab,
  Chinese, Japanese) for the British Empire (#1), the caliphates (#7, #8), the Chinese dynasties (#4, #9) and the
  Empire of Japan; the Natural History Museum (#8 on museums) typed as "museum of ... of London"; Xbox One with the
  digit glued on; Kilimanjaro's Italian name on mountains. Correctly refused: a console maker's name alone (several
  fit), a Roman amphitheatre and a Roman museum outside the ranking, Greenland and Antarctica on coastline-countries
  (not countries; the wrong-kind line is still the owner's call).

## 2026-11-18, morning check (Wed, launch day: first post 21:00 HKT)

- Owner's notes: the two Fathom notes from Nov 17 (a transfer fee readable as wages or the contract; "an even chance")
  were acted on yesterday: both reworded, the judge's check 6 "two readings" added, and a sweep of all 297 questions
  fixed 9. Owner's thumbs up: two Fathom questions (a country of about 1 million people; the world reaching 4 billion).
- A player's note on painters (Nov 17's daily) with a thumbs down, too hard: the list is too obscure for the typical
  player, fine for free play but not as a daily. One player, a taste call, so no change (it already ran and isn't
  scheduled again); passed to the lineup judges as a caution: art lists need a lower obscurity bar (painters was the
  week's lowest-priority pick, casual 6).
- Missed guesses: 15, one browser each, all correctly refused: tech companies and marketplaces on retailers, painters
  outside the auction ranking (a famous self-portraitist, a Dutch master, a Spanish Impressionist). No fix.
- Plays all time: 174 across 87 lists (+1). Today's Fathom: 1 player yesterday (649), 1 so far today.

## 2026-11-17, launch-week morning check (Tue, the last scheduled one)

- Notes since yesterday's check: none. Ratings: metro-cities (yesterday's daily) and island-countries, 1 up each.
  Plays all time: 173 across 86 lists (+6). Today's Fathom: 4 players answered Fathom #2's first question, the first
  real Fathom data (guesses only: the daily totals and Fathom feedback migrations still aren't run).
- Missed guesses: 4, one browser, all on metro-cities: three country names on a city list (the wrong-kind theme again;
  "isn't in this ranking" is true) and keyboard mash. No fix; the wrong-kind line is still the owner's call.

## 2026-11-16, launch-week morning check (Mon)

- Notes and ratings since yesterday's check: none. Plays all time: still 167 across 85 lists (no finished list game
  in 24 hours).
- Missed guesses: 5, one browser, all on yesterday's longest-running-tv: cable and streaming dramas, a cooking show,
  wrestling. The list is scripted broadcast-network series, as its prompt says; "isn't in this ranking" is right. No fix.
- Fathom: no guesses stored for Fathom #1's questions. Checked the live client (every backend call blocked, nothing
  written): Today's Fathom sends submit_fathom_guess and fathom_compare on lock-in, so nobody played it. The daily
  totals and Fathom feedback migrations still aren't run (`fathom_day_stats` missing).

## 2026-11-15, weekly lineup (week of Nov 16), Sunday fallback

- No answer from the owner by Sunday 18:00 HKT: scheduled as proposed. Mon metro-cities, Tue painters, Wed
  coastline-countries, Thu concert-tours, Fri australia-cities, Sat happiest-countries, Sun winter-olympics-countries
  (six new debut lists and one older list nobody had played), replacing the old free-play lists the scheduler had
  put on Nov 16-21. Built this cycle and judged free play: grand-slam-titles, billionaire-cities, wine-countries.
  Spare: life-expectancy-countries (fixed, approved; not the same week as happiest-countries). Every pick had an
  answer-coverage audit (about 30 fair guesses fixed) and the matcher fixes it found (country names and title words).

## 2026-11-15, launch-week morning check (Sun)

- Notes since yesterday's check: none. Ratings: landlocked-countries and world-heritage-countries, 1 up each.
  Plays all time: 167 across 85 lists (+11).
- Missed guesses: 20 texts, each from one browser, on 4 lists. Re-judged with today's matcher: none is a fair answer
  a list misses. Today's longest-running-tv drew 7: a famous cable cartoon (the list is broadcast networks only, as its
  prompt says, so "isn't in this ranking" is right), short-run dramas, a news channel. retailers drew 7 words around
  the #2 answer's first letters (the answer itself lands when typed). smallest-countries drew territories and a city.
  One two-slip misspelling of a coffee country. No fix.
- Fathom: Today's Fathom went live overnight (Fathom #1). No Fathom guesses yet on today's first question. The daily
  totals and Fathom feedback migrations aren't run yet, so the players' curve is the simulated crowd only.

## 2026-11-14, launch-week morning check (Sat)

- Notes and ratings since yesterday's check: none. Plays all time: 156 across 82 lists (+21).
- Missed guesses: 61 texts, each from one browser, on 23 lists, typed between about 19:15 and 00:15 HKT on Nov 13.
  Re-judged with today's matcher: none is a fair answer the list misses.
  - **Correctly refused** (most): first names and celebrity names on us-surnames (14), consoles that don't exist
    or have no sales figures, companies and athletes outside the ranking, a webtoon and a light novel on manga,
    cities on mcdonalds-countries.
  - **Harder misspellings** (hints, one browser): a two-slip spelling of a manga title (the right spelling, a short
    form and "slime" all land), a joke spelling of a top-10 billionaire's surname (the real one lands).
  - **Data hints** (queued): a team's nickname alone doesn't reach its stadium on stadiums; Wingstop typed again on
    fast-food-chains.
- Backend: fathom_guesses still not run (`fathom_compare` missing).

## 2026-11-13, launch-week morning check (Fri)

- Notes and ratings since yesterday's check: none. Plays all time: 135 across 73 lists (+40 since yesterday).
- Missed guesses: 158 texts, each from one browser, on 26 lists, all typed between about 10:45 and 16:05 HKT on Nov 12
  (most likely one or two players, many on Blitz). Re-judged with today's matcher: all still unknown. By theme:
  - **Real one-slip misspellings not taken** (the fix): a top-10 artist with its first letter slipped, and a
    three-letter last word slipped beside two exact words, both on spotify-artists. Cause: after shared words are
    dropped, the matcher rejects a first-letter slip under 8 letters and any slip in a 3-letter word, even when the
    exact words point at one answer. Fix in progress (matcher agent: one slip is taken beside distinctive shared
    words, with a leak audit over every list).
  - **Wrong kind** (the most common theme, 4 lists): sports typed on sports-leagues (about 10, e.g. a sport's own
    name), cities on tourism and mcdonalds-countries, countries on airports and companies-revenue. Each gets
    "isn't in this ranking. No life lost", which is true. A "that's a city / a sport" line, as Fathom has, would read
    better: method idea for the owner, not built.
  - **Harder misspellings** (hints, one browser): a two-vowel slip on Grand Teton, a three-letter rotation in
    Bundesliga, a word-order swap of Shake Shack, a two-slip Kendrick Lamar. The single-slip versions are already
    taken; left as they are.
  - **Data hints** (queued in REBUILD_QUEUE): a short form for Arabic; Wingstop missing from fast-food-chains; a
    plain-words name for the IPL.
  - **Not answers, correctly refused:** celebrity surnames on us-surnames (about 20), recent albums and songs on
    the all-time lists, regional chains, countries with no McDonald's, near-miss passwords, names outside the
    popularity tables. No change.
- Backend: fathom_guesses still not run (`fathom_compare` missing).

## 2026-11-12, launch-week morning check (Thu)

- Notes, ratings and missed guesses since yesterday's check: none.
- Plays all time: 95 across 58 lists (one new first try, on a list nobody had played), which also shows the server
  records plays end to end. Traffic is still close to zero; no launch post response yet from the owner.
- Backend: fathom_guesses still not run (`fathom_compare` missing).

## 2026-11-11, launch-week morning check (Wed)

- Notes, ratings and missed guesses since yesterday's check: none. Plays all time: still 94 across 57 lists, the
  same as yesterday morning, so no one finished a list game in 24 hours.
- Checked that it isn't a recording bug: the live site (toptentacle.io), with every backend call blocked so no row
  was written, still sends submit_play, submit_miss and list_stats when a random list game ends. The client works;
  the likely reason is no traffic (launch post not up or not seen). Asked the owner.
- Backend: fathom_guesses still not run (`fathom_compare` missing).

## 2026-11-10, launch-week morning check (Tue, launch day)

- Notes since yesterday's check: none.
- Ratings: coffee-countries (list) 1 up; music-artists (Blitz) 1 down, no reason ticked. One rating each, so a
  signal, not a verdict; both lists are in today's 16:30 protected-list rebuild anyway.
- Missed guesses: 1 text from 1 browser. On brazil-cities (Blitz), a player typed the country's own name in its
  Portuguese spelling. Today's matcher reads it as a known name that isn't in the ranking (no life lost). It could
  also be a short try at the capital. One browser is a hint, not a fix: watch for repeats, and if more than one
  browser types it, offer the capital as an option.
- Plays so far: 94 first tries across 57 lists, all time (the backend gives no per-day count).
- Backend: the fathom_guesses migration isn't run yet (`fathom_compare` is missing), so Fathom guesses aren't
  stored. The owner has the link.

## 2026-11-09, launch-week morning check (Mon)

- Notes since last night: 1, the owner's, on mlb-hits (thumbs down): the average is too high, not a list for casual
  players, "robinson" offered three Robinsons but not Jackie Robinson, and today's stars aren't near the top. Acted:
  estimate lowered (casual 4 to 2, average 4 to 3), free play only (ownerVeto, docs/OWNER_PICKS.md). The two readings
  ("robinson" without Jackie Robinson, "judge" as a #138 player instead of Aaron Judge) went to a matcher fix as rules
  for every people list. Today's stars ranking low is the source's truth (career hits favour long careers): kept.
- Ratings since last night: island-countries 1 up; mlb-hits 1 down (the owner's).
- Missed guesses: none yet. The missed_guesses migration hasn't been run on the backend.

## 2026-11-06, weekly lineup (week of Nov 9)

- Proposed 7 lists + 7 Blitzes (doc "TENtacle lineup, week of Nov 9"); the owner approved all 14 as proposed. Two new
  lists debut (sports-leagues Thu, farm-products Blitz Wed). Spares: metro-cities, coastline-countries, painters
  (split verdict), football-club-revenue (Blitz, held off the sports-leagues week).
- Risk flagged to the owner: skyscraper-cities (casual finds 6) and the billionaire-countries Blitz (casual finds 5)
  play hard.

## 2026-11-03, cycle 7 (lean), then the loop paused

- Judged: pixar-films (daily list p5: the casual finds 6), world-series-wins (daily list p5: the casual finds 6, the
  nickname fix confirmed). Daily bank: 4 approved lists (world-series-wins, pixar-films, theme-parks,
  netflix-seasons) wait for Blitz picks; dailies scheduled through Nov 21. Blitz approvals are now the bottleneck.
- Data: regional geography lists (Africa, Asia, European cities) take their answers from their region (`region` in
  topics.ts, `elsewhere` entries, validate.ts errors). Owner's call after the first version: a place outside the
  region costs a life and says so ("Tokyo isn't in Europe."); places on two continents that the source leaves out
  stay free. europe-population was a daily that day, so it was hand-patched and its rebuild is queued from Nov 4.
- Leak audit: not re-run (no matcher change this cycle).
- Method change: player ratings ("Good list?" after every list and Blitz, the `ratings` table, `list_ratings`) feed
  the loop from the next cycle (docs/IMPROVE.md step 0). The owner's complaint behind it: topics feel samey
  ("countries with the most <sport> wins"); the variety rule in step 1 already applies.
- The loop's schedule is paused (owner's session credits). Next cycle: judge Blitz candidates first, then the oldest
  Oct 30 verdicts (us-metros, empires, museums); pull `list_ratings`.

## 2026-11-03, cycle 6

- Judged: netflix-seasons (daily list p7: the casual finds 8; leans easy now that only 2 non-top-10 seasons cost a
  life), dog-breeds (daily list p7: the casual finds 8), tiktok-accounts (free play, Blitz-ready: the casual finds 5),
  world-series-wins (fix-first p6: ranked teams' nicknames weren't recognized; fixed in the pipeline, re-judge next).
  Daily bank: 11 approved lists unscheduled; scheduled through Nov 12, no top-up.
- Matcher: plain words decided per list (a word is plain unless a notable entry on this list carries it; the
  lexicon now lists 7,677 such words); known names match however they're spaced ("golden doodle"); part of a name
  followed by something not in it is someone else ("charli xcx", "monster menendez", "stranger things final
  season"); ordinals and instalment words ("squid game second season"); "story" a category word.
- Data: team universe nicknames reach the table rows they merge with (World Series and Super Bowl lists; validate.ts
  check); zero counts show "0"; `knownNames` for usual spellings of famous non-answers (crossbreeds, Monster
  seasons); brand-account junk shared across the social lists; Lisa and Lena's 2017 figure; French Poodle.
- Leak rate: 1.4% -> 1.3% (1287 of 98,054, 99 lists). What is left is mostly country names inside park,
  stadium and building names ("china" to Bank of China Tower) and surnames ("king" to Zach King): near the floor
  of what the audit can call wrong.
- New topics: pixar-films ("Highest-grossing Pixar films"; casual 6, Blitz 19/20; every Pixar feature with its
  gross, other studios' films free). Parked: best-selling book series (five-way tie at #10).
- Next: judge pixar-films and world-series-wins (fixed); oldest Oct 30 verdicts (us-metros, empires, museums).

## 2026-11-03, cycle 5

- Judged: concert-tours (daily list p9, also Blitz: the casual finds 7), athletes-earnings (daily list p7: the casual
  finds 6 now that past stars are free), mcdonalds-countries (daily Blitz p7: the casual finds 9; Blitz 31/32, no
  fixes), netflix-seasons (fix-first p6: every Netflix original cost a life with no figure; now only seasons with a
  figure are answers, the rest free; re-judge next). Daily bank: 9 approved lists unscheduled; scheduled through
  Nov 12, no top-up.
- Matcher: a slip beside a shared word counts ("john rahm"); obscure pool names (no rank, no figure) take only
  mid-word slips ("planes" no longer Our Planet; "titanik" still Titanic, which has a figure); a plain word's slip
  keeps its first letter ("doodle" no longer Poodle); "season", "part", "music", "band" are category words and the
  subject with a small number names nothing ("season 3"); a short name with the rest naming its only entry ("bts
  arirang"). Each change checked against simulated typos of 2,088 answers: none lost.
- Data: placeholder rows never answers (validate.ts errors); Netflix free pool via `knownOnly` (its leak 145 -> 0);
  near misses with a figure typed by surname; concert-tours Styles, Elton, Elevation, Zoo TV; junk redirects never
  claim a namesake by article.
- Leak rate: 1.6% -> 1.4% (1310 of 96,066, 98 lists); netflix-seasons 14% -> 0. Worst now theme-parks and stadiums
  (8.9%), mostly words of pool names ("china", "town", "water").
- New topics: dog-breeds ("Most popular dog breeds in the US (AKC registrations, 2025)"; casual 8, a possible daily;
  crossbreeds free). Parked: most valuable sports teams (Forbes 2025 ties at #10/#11).
- Incident: a container restart killed the data agent mid-cycle. Its committed work survived in the worktree; a
  new agent resumed there. Ten old merged worktrees removed.
- Next: judge netflix-seasons (fixed) and dog-breeds; the daily-list "too easy" 9s from Oct 30 (countries-area,
  us-metros, asia-population) as Blitz candidates.

## 2026-11-02, cycle 4

- Judged: car-models (daily list, p7: the casual finds 7; added to the bank), music-artists (daily Blitz, p8: the
  title now names the measure; the casual finds 9, too easy for a list), concert-tours (fix-first, p8: "tour" alone
  handed over the top 10; otherwise a daily list and a Blitz; re-judge next), athletes-earnings (fix-first, p6:
  every Forbes top 10 since 2012 cost a life, so the casual found 5; now only 2024+ near misses count, replay 7).
- Matcher: a list's own noun words are category words ("names" no longer James, "museums" no longer the Vatican
  Museums); a word shared by 3+ top-10 answers, or a crowd with 2+, asks for more ("tour", "toyota", "china" on
  banks); a plain word gets one slip at most, onto a ranked answer ("barrel" no longer Brazil, "action" no longer
  the Amazon; "hungry" still Hungary; lost: "cypress" for Cyprus, now a free miss); short artist names pick by the
  rest ("u2 vertigo"); a name plus another number is a free miss ("frozen 3", "bridgerton 2").
- Data: car models named "Toyota Corolla" style; athletes' past stars free, Burrow and Usyk with figures, a Forbes
  2026 title; tour facts name the artist, tour grosses from infoboxes so 54 of 57 unranked tours score in Blitz;
  MJ, RHCP, Led Zep. Camp Nou keeps 99,354 (no current figure to override with).
- Leak rate: 1.6% overall (1476 of 94,041, 97 lists), but on the same 95 lists 1.53% -> 1.44%. The new
  netflix-seasons list is the worst at 14.3%: its pool is every Netflix original, so "cars", "planes" and "water"
  find obscure shows. Next: plain words or a narrower pool there.
- New topics: netflix-seasons ("Netflix seasons with the most views in their first 91 days"; casual 7, a possible
  daily; "squid game" is Season 1, later seasons by number) and mcdonalds-countries (casual 9, too easy for a list;
  Blitz 31/34). Both need a judge.
- Method: judge brief now types the subject and categories alone, keeps old rankings free on one-year lists, and
  asks facts to name what players answer by. Test over every built list: its noun never hands over a top-10 answer.
- Schedule: through Nov 12, 7 approved lists unscheduled, no top-up.
- Next: judge concert-tours and athletes-earnings (fixed), netflix-seasons and mcdonalds-countries.

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
- Leak rate: 1.6% -> 1.5% (1388 of 90,486, 95 lists; the new in-order word reading added none). Worst: theme-parks,
  stadiums, youtube-channels, video-games. What is left is mostly words that name top-10 answers on other lists
  ("water", "music", "china") and near-spellings of plain words ("planes" to Planet, "rice" to Nice).
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
