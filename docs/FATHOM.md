# Fathom

The estimation game, a full game mode since Nov 9 (the owner: "ship it now") and a daily since Nov 14: **Today's
Fathom** (`#fathom`), ten questions a day, the same for everyone, one try, 20 seconds a question. The player types a
number (or, in the name-it round, a name), and the score is plain closeness, by one rule for each round (`scoreFor`,
`src/game/fathom.ts`), out of 1000. Ten since Nov 14 (owner: "change it to 10 questions to keep in line with the 10
theme"), five before: those games keep their own total out of 500. Endless Fathom (NEW QUESTIONS draws another game)
stays playable at a hidden address, `#fathom-endless`, linked from nowhere (owner, Nov 14: "remove the unlimited
fathom play for now- keep access to it via a hidden url"). The questions live in `public/fathom/questions.json`; the
name-it round's lists in `public/fathom/lists/<id>.json` (built by `scripts/fathom/lists.ts`); the days in
`public/fathom/daily.json` (written by `scripts/fathom/daily.ts`).

## Where it lives

- **Home**: Today's Fathom in the Today panel, under Today's list and as wide (Today's list keeps its big key), a key
  as tall as a free-play key with no description line, only its state: "new", "playing", then the total ("712/1000").
  The panel's countdown ("new in 06:29:10") is for both. Nothing of Fathom in Free play.
- **The menu**: a Today's Fathom tile in Play (a sonar's rings) with the same state, marked while it's on show; no
  endless tile.
- **How to play**: rule 7, Today's Fathom in the game's own words (ten a day, 20 seconds each) and its scoring rule
  (the only place it's written).
- **Stats**: a Fathom card under the lists' sections: games, avg / 1000, best / 1000 over every finished game of ten;
  "0", "--", "--" and a key to play before the first. The games of five from before Nov 14 stay out (a total out of
  500 doesn't average with ones out of 1000): their totals are kept apart (`totals`; ten-question games in
  `totals10`), and Past runs still shows them.
- **Past runs**: each finished game under its day, a square a question for a title (ten, smaller, or the old five)
  and its total out of its own maximum, tagged FATHOM #12 (a day's game, by its number, as Today's list's rows are) or
  FATHOM (endless); the row opens that game's results (`#fathom/run-<startedAt>`: the total, the squares, when it was
  played, the recap of the questions still in the bank, SHARE, and a TODAY'S FATHOM key to the day's game, where it
  is).
- **The share text** (SHARE, as on lists and Blitz: the phone's share sheet, else a copy and "Copied"): "Fathom #12
  712/1000" ("Fathom 712/1000" for an endless game; "/500" for a game of five), a square a question in the results'
  colours (🟨 dead on, 🟦 close, 🟪 near, 🟥 far, ⬛ lost at sea or time's up), and the link to `#fathom`, each line but
  the last ending in two spaces so a Reddit comment keeps them (`pasteable`, src/components/share.ts).

## Today's Fathom

- **The schedule** (`public/fathom/daily.json`: `{ n, date, ids }` a day, ten ids, Fathom #1 on 2026-11-14): written
  by `NODE_NO_WARNINGS=1 npx tsx scripts/fathom/daily.ts --days 7`. Each day is a full game in the round mix (an easy
  number first, then by the draw's own rules), no question comes back, and today's and tomorrow's entries are never
  changed once written; the days after them are chosen again on each run. Ten a day uses the bank twice as fast as
  five, so the script always says how many days the bank covers with questions not asked yet (137 questions on Nov
  14: 12 days, through Nov 25, the 12 name-it questions running out first), and fails loudly, writing nothing, when
  the days asked for go past that: add questions, ask for fewer days, or pass `--repeat` to let the bank start over
  (the last few days held back). It also fails when today's or tomorrow's entry asks a question the bank no longer has
  (put it back, or rewrite that day by hand); a past day's is only a warning. `scripts/fathom/daily.test.ts` holds the
  committed file to all of it, every scheduled id from today on in the bank included: a question renamed or dropped
  fails `npm test` until the script is re-run; a file short of a week ahead fails it while the bank has another day.
- **A day the file doesn't cover** (it ran out, or didn't load): the game seeds that day by its date from the bank, by
  the same rules, continuing from the file's last day (`dayFor`, `src/game/fathom-daily.ts`: the same code the script
  uses), so everyone still gets the same ten; it is numbered by days since Fathom #1. Unlike the script, it never
  stops: once the bank has run out it starts over, holding back the last few days. A scheduled day whose questions
  aren't all in the bank is seeded the same way.
- **One try**: the day's game under way is this browser's (`tentacle:fathom-daily`, with its day): a reload, Home's
  key or the menu's tile resumes it; yesterday's unfinished game is dropped at midnight (and a day's game of five from
  before the switch starts over as the day's ten). Once finished, the run is in the save tagged with its day
  (`daily: { date, n }`), so the day reopens on its results on every device: no key for new questions, "next Fathom
  in 06:29:10" instead. The day's game never sits behind a sign-in.
- **The clock** (owner, Nov 14: "add a timer per question (maybe like 20s)"): `QUESTION_SECONDS`, 20, from when the
  question shows and the field takes typing. "0:17" at the end of the card's header, quiet (the muted label colour),
  pink for the last five seconds (`WARN_SECONDS`); four tabular characters, no animation, its box kept (hidden) on the
  reveal, so nothing moves. Paused while the tab is hidden; the time a question has used is kept in this browser
  (`tentacle:fathom-clock`), so a reload doesn't give it back. At 0 a guess that reads locks in, as LOCK IN would (a
  name-it round: a name the list has, or a misspelling of one thing it would have asked to confirm); anything else
  scores 0, and the reveal says "Time's up" with the answer, the fact and the source (a name-it round's best answers
  too), no guess and no sonar. The round's id goes in the game's and the run's `timeouts`; its square is lost at sea's,
  and the recap reads "time's up · answer 126 litres". The name-it round keeps the same 20 seconds for now (not yet
  play-tested by a person against the clock; the browser suite's name-it rounds lock well inside it).
- **The running score** (owner, Nov 14: "add points to a visible counter ... some kind of bar at the top ... sleek and
  minimalistic"): under the question card's header, the total out of 1000 and ten pixel cells, one a question and its
  100 points, each filled by what it scored in its band's colour, the one on screen outlined, a played one ringed in
  its band's colour (lost at sea's in the label colour, so a 0 reads as played). The cells are the progress squares
  too: ten pips beside "Question 1 of 10" took 314px of a 250px card at 320. On each reveal the total counts up and
  the new fill grows in (neither with reduced motion). It is there, empty, from the first question, and its total sits
  over a hidden "1000/1000", so nothing moves or resizes as points land or the clock ticks (e2e/fathom-daily.e2e.cjs
  measures it at 320, 390 and 1440). With the keyboard up (little height) it gives its row to the question and the
  field; the clock stays.
- **Where you stand**: the day's results end with the players' average, the players' curve over 0 to 1000 (below; the
  player's marker at their total, a caret under the average) and "you did better than 81% of players today". Endless
  Fathom's results and a past game show none.

## The players' curve

Owner, Nov 14: "for histogram instead of a bar chart style can you do a actual curve? apply this style throughout but
keep it within thematic style". One component, `CrowdCurve` (src/components/CrowdCurve.tsx, its maths in
crowd-curve.ts), draws every players' distribution: a list's results (11 scores) and Today's Fathom's (100 bins of
10 points); Stats and Blitz draw none. The counts are read as a density, each bin's players spread evenly over its
width, then a Gaussian blur of half a list bin (the same width on both), reflected at both ends: the area stays the
counts' and a blur makes no new peak, so the curve never shows a bump the counts don't have. It is sampled in 50
columns of 3px, each height snapped to 3px steps (the old bars' step): a stepped pixel curve 150 x 39 on the bars'
hairline baseline, 150 x 42 in all, where the 11 bars were. The area is the bars' slate, a little brighter from the
left edge to the player's score (the players they did better than); the player is a thin pink line and a 6px pink
square on the curve (the old bar's pink and glow), never clipped at 0 or the maximum; the average is the gold caret
under the baseline; the scale's ends under it (0 and 10, 0 and 1000). No animation; the aria-label says the line.

## The save and the sync

The game on screen (its questions, guesses, picks and when it was drawn) is this browser's own (`tentacle:fathom` for
endless, `tentacle:fathom-daily` for the day's): a reload picks it up, results included. Everything else is in the player's save (`Saved.fathom`, `top-tens:v1`,
`src/game/fathom-history.ts`), so it travels with an account like list games, with no new table (the account's save
is one JSON object): every finished game (Past runs, the last 100, each question's points kept as scored), every
finished game's total (Stats, never pruned), and the last 3 endless games drawn (held back from the next draw on every
device). A day's game carries its day (`daily`), which is how another device knows it's played.
The sync merges two devices' copies as the union, one game per start (`mergeFathom`, called from
`src/net/sync/merge.ts`), a reset on another device prunes it, and a game finished here asks for a sync
(`reportFathom`). Settings' reset clears both.

## The rounds

A question's `round` says how it is asked and scored (absent means an estimate). `kind` is its topic, apart from this.

The rounds share one curve (`curve`): 100 x max(0, 1 - \|d\|)^2, rounded, with d a distance that is 1 where the curve
reaches 0. A miss scores at most 99: only spot on is 100.

| Round | The player types | Points | The rule (How to play only) | The miss |
|---|---|---|---|---|
| `estimate` | a number in the question's unit | the curve: round(max(100 x max(0, 1 - |d|)^2, 30 x max(0, 2 - |d|))), d = log10(guess / answer) (owner, Nov 14: 10x off is worth 25 to 40, not 0); within 1% spot on, 100. 25% off 82, half or double 51, 3x 46, 10x 30, 100x 0 | "The closer your guess, the more points." | "30% low", "3x too high" |
| `percent` | 0 to 100: "71", "71%", "71.5" | the average, rounded, of two scores: points off (100 - 3 x points off, never under 0) and times off (the curve, d = how many powers of ten off on the answer's side of 50: up to 50 the shares, log10(guess / answer), past 50 what's left, log10((100 - answer) / (100 - guess)), each kept to 0.5 to 99.5); within half a point spot on, 100. 20 for 25 84, 5 for 2.5 72, 10 for 2.5 60, 0.8 for 25 21, 90 for 71 45; 90 for 99 scores as 10 for 1 (52) | "The closer your guess, the more points." | "6 too low" |
| `year` | an AD year, up to four digits: "2007" | the curve, d = 2 x log10(ago(answer) / ago(guess)), ago(y) = max(1, this year - y); the exact year 100. In 2026: 1984 for 1967 51, 1960 for 1967 81, 2010 for 2007 72, 2000 for 2007 53, 1850 for 1903 51, 2017 for 2007 41 | "The closer your guess, the more points." | "3 years early" |
| `name` | a name from the question's list: "Colombia" for "Name a country with about 50 million people" | the thing's figure against the target: a `ratio` list by the estimate's rule, a `steps` list 100 - 30 x steps off (one off 70, two 40) | "The closer to the target, the more points." | "6% more people", "2x too many people", "2% low" (an area, a unit of measure), "3 land borders too many" |

Why these: the owner played and found "0.8% for 25%" (the beetles' share of animals) scoring 27 while "1984 for 1967"
(the first heart transplant) scored 15: "theres no way my second guess was considered worse". The old rules (100 - 3 a
point, 100 - 5 a year) counted every point and every year the same, wherever they were. He then filled a calibration
sheet (Nov 8): 15 pairs of guesses (which is better, or about the same) and 5 ratings. The old rules agreed with 6 of
his pairs and 2 of his ratings. A first try, a percent by times off alone and a year with 3 x log10, agreed with 12
and all 5, but was too harsh: "i would give some points for 0.8, not 0, 2.5 for 5 isnt that bad id give 60-75 points,
in general a lot of these were fine before". These rules agree with 14 of his pairs and 4 of his ratings
(`fathom.test.ts`, "the owner's calibration (Nov 8)", asserts each one, and his two notes; the misses: pair 6, 2000 for
1992 at 59 against 20 for 8.8 at 41, which he called the same, and 1880 for 1903 at 72, which he rated Ok, 25 to 65).
What he goes by: a share is off partly by how many times, as an estimate is (0.8% is 30x too small a share of 25%), and
past 50 it is what's left that counts (90% for 99% leaves 10x too much), with points off keeping a near miss in points
worth something; a year is off by how long ago it was, so 17 years off an event 59 years ago is far, and the same off
one 120 years ago is closer. That is steep for recent events (2017 for 2007 scores 12), so the bank's years are at
least 10 years ago (`check.ts`). The miss reads in percentage points, without the word (the reveal's points are the score: "6 too low"), and in
years ("3 years early").

No round shows a scoring line, on the question, the reveal or the results (owner, Nov 14: "self intuitive already
enough id just remove it"; UX.md 21): How to play explains it. The rule column above is what How to play says. On
each side of the answer a closer guess never scores less (`fathom.test.ts`).
Whatever reads "spot on" scores 100, in every round. The bands, the sonar, the share text, the sound and the
celebration work the same for every round. The sonar places the squid by the distance the points come from
(`offAxis`), its edges where the round's curve reaches 0: 10x off for an estimate, \|d\| = 1 for a year (about 3.2x off
how long ago), and 10x off the share (or what's left) for a percent, where its points-off half may still score (0.8 for
25 sits at the edge with 14). On either side, further out never scores more.

The field: a decimal keypad for an estimate and a percent ("%" beside it for a percent), a plain number pad for a year
(on a phone, to 420px, an estimate's unit goes on its own line under the number, inside the field, so the number has
the whole width: "metres per second" once took two lines and cut the placeholder),
which never groups its digits ("2007", not "2,007"). A percent of 0 is a fair guess; past 100 says "0 to 100, please."
A year with a fraction says "A whole year, please.", five digits "A year has four digits." A name-it round has a text
field ("your country") and no unit.

### The name-it round

The owner: "Name a country that has 6 land borders", "Name a human organ that weighs about 1 kg" ... "brain didn't even
register". **A fair answer must always register**, and one answer locks per round.

- **Reading the name** (`readName`, `src/game/fathom-name.ts`): TENtacle's own matcher (`judgeGuess`,
  `src/game/match.ts`) over the list's names and aliases, so "UK", "Türkiye", "USA", "Holland" and typos read as they
  do in TENtacle. An exact name or alias locks at once. A misspelling that points at one thing goes in the box to
  confirm ("France? Lock in to confirm."); a name several things share offers them to tap ("Irak": Iran or Iraq;
  "Congo"); a tap fills the box. Only a name on the list locks; nothing else costs anything.
- **What isn't on the list** says why, and costs nothing: a thing on another of the game's lists ("Paris is a city, not
  a country. Try again.", read before any misspelling, so "Lagos" is the city, not Laos, and "Mexico City" not Mexico);
  a place no list has (`PLACES`), never an answer, never corrected into one, read before any misspelling or near name
  of another kind, and only when the list doesn't have the name (Georgia is the country): territories ("Greenland is
  a territory, not a country."), US states, continents ("Africa is a continent, not a city.", not South Africa), the
  UK's nations ("Scotland is part of the UK. Try again."), islands and regions of one country ("Tasmania is part of
  Australia, not a country.": it was offered as Tanzania), a city's boroughs ("Brooklyn is part of New York City, not a
  city."), regions of several ("Scandinavia is a region, not a country."), countries that no longer are ("Yugoslavia
  is no longer a country."). Nothing disputed: a breakaway region or a claimed territory is left to the lexicon. A real
  name the list lacks, by the game's lexicon ("Berlin isn't one of our 85 cities.", "Dubai" on a city question, not
  Mumbai); a name the lexicon knows is offered as a misspelling only one slip from what it reads as ("Chili", "Perm"), or
  when the game stores it as one ("Irak", Iraq's): "Abkhazia" is not Afghanistan. A name read before the lexicon has
  loaded waits for it (a moment at most). A list's inverted and short forms read exactly ("Korea, North", "Gambia,
  The", "Dominican Rep."). The question's own yardstick (`except`: "Any country but United Kingdom."); anything else,
  "Not one we know. Try again." Every line that costs nothing ends "Try again.", in two lines at 320px (`LINE_MAX`, 58
  characters, measured): a longer one drops "not a country" from a part of something ("The Canary Islands are part
  of Spain. Try again."), else leaves the name out ("They are a territory, not a country. Try again.").
- **The reveal**: the target, what was named and its figure ("Colombia, 52.89 million people"), the points, the sonar
  on the list's scale (10x off at its edges on a ratio list, 3.3 steps on a steps list) with the miss under it, the
  best four answers on the list with their figures (by points, then closeness, then the list's order; the yardstick
  left out), the fact if the question has one, and the list's source with its date. The results' recap reads "you
  Colombia 52.89 million · target 50 million people". With a backend, the figure of the thing named is sent as the
  guess (docs/BACKEND.md), but the reveal shows no players' line (their typical figure means little there).
- **Its lists**: `{ id, noun, nounPlural, measure, scoring: "ratio" | "steps", source: { title, url }, asOf, entries: [{
  name, aliases, value }] }`, each complete for what it holds (every country). Built from the puzzles' forms, plus the
  forms a judge found missing (`FORMS`: Kampuchea, Jibuti, Hindustan, Dakha...), less any alias that is a place of its
  own (`PLACES`, and the nations' people: "England", "Scottish" once locked the whole UK) and redirects that are no
  name (`NOT_A_NAME`: "Zambian sports"); `lists.test.ts` holds the committed files to both. The game fetches the lists the bank's
  name-it questions use before it draws; a question whose list didn't load, or whose target leaves fewer than 3 good
  answers on it (a list that changed), is left out, and the fifth round is an estimate.

## A game

Ten rounds (`GAME_ROUNDS`): five estimates, two percents, two years, and a name-it round (an estimate when the bank
has none whose list loaded); five before Nov 14 (two estimates, a percent, a year, a name-it round). One name-it
round, not two: the bank's 12 would last six days at two a day, and a name against the clock is the slowest round.
20 seconds a question (The clock, above). The first question is an easy one, and a number to type (never the name-it
round); the other nine come in a random order. Within that: none from the last 3 games while the bank has others
(then the oldest come back first), kinds as spread as the bank allows (a kind not in the game yet, then the least
used), and at most three how tall / how heavy questions. A round the bank has none of is played as an estimate, so a
small bank never breaks a game.

**A how tall / how heavy question** (`isSizeQuestion`): an estimate whose unit is a length or a mass (any scale word in
front) and that asks how tall, long, high, deep, wide, big or heavy something is, or what it weighs ("How tall is the
Eiffel Tower?", "How long is a marathon?", "How much does an ostrich egg weigh?", "What weight of tomatoes..."). Not
one: a distance ("How far away is the Moon?"), an amount used or grown ("How much tea does Turkey get through?", "How
much can bamboo grow in a day?"), a duration, a count, an area, a percent or a year. The draw takes at most three a
game (two of five before Nov 14);
the bank should hold no more than one in five (`check.ts` reports it as a warning until the rebuilt bank lands; the
old bank had 43 of 94).

## Where you stand (simulated crowd)

Today's Fathom gives everyone the same ten questions, so its results say "you did better than 81% of players today"
over the players' curve of the day's totals, with no "estimated" tag (owner, Nov 14). The maths is `src/game/fathom-crowd.ts`;
the backend calls are `reportFathomDaily` and `useFathomDay` (`src/net`), on
`supabase/migrations/20261114120000_fathom_plays.sql`.

- **What's simulated** (owner: "just simulate a relatively normal distribution around [a proxy average] (albeit
  skewing to the right cause some ppl do rly good)"): the day's expected total is its questions' expected points,
  summed, the scoring agent's numbers for a typical miss on the gentler curve: 66 for an easy question, else 47 for
  an estimate (the writers' typical miss, about 2.3x on the questions that aren't openers), 58 for a percent, 55 for a
  year, 60 for a name-it round. The usual day of ten (an easy opener, four estimates, two percents, two years, a
  name-it round) expects 540, and every day the 137-question bank draws expects about 530 to 615. Around it, a two-piece normal curve, its standard deviation 140 points below its peak and 240 above (twice the
  five-question game's 70 and 120: a player's knack carries across the day's questions, so ten spread totals about
  twice as far), placed so half the simulated players score under the expected total: the middle 80% run from about
  215 under it to 260 over, the mean sits about 11 over, and nothing falls outside 0 to 1000 (the curve is cut there).
  100 bins of 10 points (1000 shares the last with 990-999; 10, not 20, so totals 10 apart rank apart), the same every
  time (no randomness). The curve on screen blurs them (The players' curve).
- **How it's labelled**: it isn't. The line counts the simulated players as players; `n` (the real ones) comes with
  the standing for a screen that wants it.
- **How real players replace it**: each finished Today's Fathom sends its total once per browser and date
  (`submit_fathom_play`, offline it waits); `fathom_day_stats` gives that date's totals in the same bins, one per
  player (their first that day), everyone counted. The simulation counts as W = 30 virtual players (`ESTIMATE_WEIGHT`)
  and every real total joins it, as lists blend (docs/BACKEND.md, How the averages blend): 30 real players weigh as
  much as the simulation, 300 make the curve about 91% real. Without a backend, or before the migration has run, the
  curve is the simulation alone.
- **The line's number**: the share of the day's players below the total's bin, plus half of those in it (par.ts's
  `percentile`), at most 99: nobody beats everyone.

## The bar: what gets in

The owner: "Too many are how much does xx weigh, how tall is xx." A question gets in only if a curious person can
reason their way toward the answer from something they already know. It must pass all three:

1. **A familiar subject.** Everyone has seen it or heard of it: a giraffe, a football pitch, Bitcoin, the Moon, Harry
   Potter. Never an obscure case of it (a rare animal, a bank card's size, one particular bridge nobody has crossed).
2. **A way in.** You can work toward the answer from something you know ("I'm about 1.8 m tall, so a giraffe is..."; "I
   was at school when the films came out, so the first book..."). A question you either know or you don't is out,
   however true.
3. **A reveal worth it.** The answer surprises or teaches, and the fact under it explains the number (what it compares
   to, why it is that big or small). A dull administrative number is out.

| Question | Verdict | Why |
|---|---|---|
| How long is a football pitch? | kept | everyone has seen one; reason from strides or a running track |
| How much of the Moon's surface can we see from Earth? | kept | you know it shows one face, so about half; the wobble makes it 59% |
| How tall is a bank card? | dropped | nobody pictures it: it's in your wallet, but not a thing anyone measures |
| How long is the Trans-Siberian Railway? | dropped | familiar name, nothing to reason from: you know it or you don't |
| How heavy is an obscure animal? | dropped | not a familiar subject |
| How fast does sound travel through air? | dropped (owner, Nov 14) | a physics constant: you know it or you don't, with nothing to reason from |
| How hot is the surface of Venus? / When did the dinosaurs die out? | dropped (Nov 14) | a planetary constant and a famous figure: known or not, nothing to reason from |
| Name a country with no land borders | dropped (owner, Nov 14) | "basically its to name an island ... too ez to get deadon": a target many answers hit exactly |
| What share of the body's energy can the brain use? | dropped (owner, Nov 14) | "what exactly is energy?": a key word read two ways |

**Two rules from the owner's notes** (Nov 14). A name-it target needs few exact hits and answers on both sides of it:
never an extreme (0 land borders) or the most common value (3 land borders: 28 countries hit it). A key word a player
can read two ways (energy, size, big, fast, long) names its measure in plain words ("about the same area as", "how
far is a marathon"). A figure only specialists recall becomes arithmetic when the definition gives the one anchor
players can't be expected to know (the ISS's speed in the definition: the question is then the orbit time).
Each question's way in is kept in `scripts/fathom/ways.json`.

**The owner's favourite kind** (Nov 14, from another game's questions he liked and disliked; ours are our own): the
ones that are "actually fun to figure out". He liked a question you answer by starting from yourself (your own weight
for the average adult's), one you work out with arithmetic from known anchors (the world's population and a rough
birth rate for babies born a day), one you solve by checking (count the letters), and a superlative with a surprising
winner. He disliked a physics constant and, by the same test, a release year you only recall. So prefer, in this
order: **reason from yourself**, **Fermi arithmetic from two anchors**, **check it yourself**, **a surprising
superlative**; and cut **pure recall** (constants, dates, a figure with no way in), however famous the subject.

## Writing questions

Write our own questions from facts. Never copy one from another estimation game.

**Shape** (`version: 1`, then `questions`):

```json
{ "id": "eiffel-tower-height", "kind": "landmarks",
  "question": "How tall is the Eiffel Tower?", "unit": "metres", "answer": 330,
  "definition": "to the tip",
  "fact": "It was the tallest human-made structure in the world for 41 years, until New York's Chrysler Building in 1930.",
  "source": { "title": "Eiffel Tower", "url": "https://en.wikipedia.org/wiki/Eiffel_Tower" },
  "typical": 2, "easy": true }
{ "id": "moon-visible-share", "kind": "space", "round": "percent",
  "question": "How much of the Moon's surface can we see from Earth?", "unit": "percent", "answer": 59,
  "definition": "added up over time",
  "fact": "It always turns the same face to us, but it wobbles as it orbits, so we see a little way round its edges.",
  "source": { "title": "Libration", "url": "https://en.wikipedia.org/wiki/Libration" }, "easy": false }
```

- **`id`**: kebab-case, unique.
- **`kind`**: one of body, animals, landmarks, places, space, food, everyday, nature, science, sports, culture,
  lists. `lists` is for figures from TENtacle's own lists (`public/puzzles/*.json`); about 6 in 50 at most.
- **`round`** (optional): `percent`, `year` or `name`; leave it out for an estimate. The rules for each are below (a
  name-it question has its own shape).
- **`question`**: plain, dry, one question ending with "?", naming exactly what is measured. The unit stays out of it:
  the game shows `unit` beside the input. A count names what it counts once, right after "How many" ("How many keys
  does a modern piano have?", unit `keys`); a measure never does ("How tall is it in metres?" is wrong). No trick
  wording, and nothing in the question or the definition that gives the number away. Keep it short: the question names
  the thing ("How tall is the Statue of Liberty?"), the definition says exactly what is measured ("ground to torch tip,
  pedestal included"), and its words match the measure ("How long" for a card's long side, not "How wide").
  **Question and definition together stay within 100 characters**, so with a phone's keyboard up the question, the
  field and LOCK IN all stay in view (`check.ts`; `e2e/fathom.e2e.cjs` plays every question in the bank at 375x400).
- **`unit`**: plural, lower case (`degrees Celsius` is the one capital), metric: `metres`, `litres`, `kilograms`,
  `kilometres`, `square kilometres`, `minutes`, `people`, `times`... `years` only as a duration. A unit of measure
  must be one the game reads (`UNITS` in `src/game/fathom.ts`): players may type it after the number in any form
  ("343 m/s", "390000 km2"), and other units of its kind are converted exactly ("1.5 km" in metres); anything else
  counts things. `src/game/fathom.test.ts` reads every answer back typed with its unit. A percent's unit is `percent`
  and a year's `year`, and only theirs.
- **The unit a person would answer in, so the answer is short.** The player just types the number (there are no
  thousand/million/billion keys), so pick the unit someone would naturally say the answer in, scaled so the answer
  has **at most 6 digits before the decimal point**: kilometres, not metres, for long distances (the Moon); tonnes,
  not kilograms, for a festival's tomatoes; and for big counts a scale word in front of the unit: `million people`
  for a city of 8.8 million (8.80419), `billion chickens` (26.5), `million litres` for a pool (2.5). The scale words are
  `million`, `billion` and `trillion`; use the largest that keeps the answer at 1 or more (`trillion trees`, 3.04,
  not `billion trees`, 3,040), and never one the answer is under 1 of. A player who types the whole amount anyway ("8,800,000",
  "8.8 million") gets it read back in the unit. `scripts/fathom/check.ts` enforces the 6 digits.
- **`answer`**: a positive number in that unit, as the source states it, converted exactly (145,000 kg is 145 tonnes;
  no new rounding). No ranges: take the source's central or official figure, and say which in `definition` when it
  matters.
- **`definition`** (optional): one short phrase, no full stop, only when the answer depends on it: "city proper, 2020
  census", "to the tip", "average distance".
- **`fact`**: one true sentence the player reads after guessing, from the same source, about the number they just
  guessed: what it compares to, how it was counted, what makes it big or small ("That's 46% fewer than when farming
  began", not "The first trees evolved 400 million years ago"). It may restate its own answer, never another
  question's.
- **`source`**: the page you actually opened and took the answer from (its canonical title and https URL).
- **`typical`** (optional, estimates only): the typical miss, as a ratio: half of casual 18-35 players would land
  within this many times of the answer. One of 1.3, 1.5, 2, 3, 5, 10, 30. A writer's estimate of difficulty: the game
  no longer reads it or scores by it (the owner, Nov 5: one rule for every question), and players never see it. The
  older questions carry it; new ones may leave it out. A percent or a year never has one (a ratio means nothing there).
- **`easy`**: true for a good opener, where most people have a rough anchor (the Eiffel Tower, a marathon, the share
  of people who are left-handed).
- **`verified`** (optional): true once a judge has opened the source and confirmed the figure. The game ignores it.

**A label for a less familiar subject.** The test is a 20-year-old today: would they know what it is the moment they
read it? When they'd know it in a few words, say those words in the question rather than drop it: "How fast did
Concorde, the supersonic passenger jet, fly?" (the owner: "i wouldnt mind the concorde question if you maybe added -
the supersonic aircraft"). The label says only what anyone who knows the thing knows, never the number. Drop a
question a label can't make interesting or reasonable (counting chess positions, "ordinary matter").

**A percent question** (`round: "percent"`, unit `percent`): a share of a whole everyone can picture (the air, the
Moon's face, people), answered 0 to 100 as the source states it (20.95 is fine; the game shows "20.95%"). Ask "How
much of...?" or "What share of...?", never "What percent of...?" (the "%" is beside the field). The way in is the
whole: you can reason from a part you know (one face of the Moon, the left-handers in your class). An answer within a
few points of 0 or 100 leaves little to reason about; prefer one in between. A share that changes year to year carries
its year in the definition.

**A year question** (`round: "year"`, unit `year`): one event with one year, a whole AD year of four digits (1000 to
10 years before this year: a year scores by how long ago it was, steep for something recent), as the source dates it. Ask "In what year...?" or "When...?". No spans ("the Middle Ages"), no "c. 1500",
nothing the source dates two ways. The way in is a date the player already has: their own life, a war, an invention,
something before or after it ("before the iPhone, after the internet"). The fact puts the year in context, never a
second date that gives it away. The year must not appear in any other question's question, definition or fact
(`check.ts`: two questions in one game would give it away).

**A name-it question** (`round: "name"`): the player names a thing from a list whose figure is close to a target.

```json
{ "id": "name-country-6-borders", "round": "name", "kind": "places", "list": "land-borders", "target": 6,
  "question": "Name a country with 6 land borders", "easy": false }
{ "id": "name-country-as-big-as-uk", "round": "name", "kind": "places", "list": "countries-area", "target": 244376,
  "question": "Name a country with about the same area as the UK", "except": ["United Kingdom"], "easy": false }
```

- **`list`**: a list id in `public/fathom/lists`. It gives the question its unit (the list's measure), its source and
  its scoring; leave `unit`, `answer` and `source` out.
- **`question`**: "Name a ..." or "Name an ...", naming the list's noun ("country", "city"), no end punctuation, the
  target in it as a player says it ("about 50 million people", "6 land borders", "about the same area as France"). 100 characters with the definition, as any question.
- **`target`**: in the list's measure (people, square kilometres, land borders): a whole number on a steps list, more
  than 0 on a ratio list. When the question names a yardstick ("as big as the UK"), the target is that thing's own
  figure on the list, and the yardstick goes in **`except`** so it doesn't score (a definition says it when the target
  is another figure for it: "mainland France, without its overseas regions").
- **Several good answers, not one**: at least 3 things on the list score 70 or more against the target (Close:
  within about 1.45x on a ratio list, one step on a steps list), so a fair answer is never a lucky one. Targets in the
  middle of a list's range: the cities list holds only cities of 5 million and more (UN 2025), so no city target under
  about 8 million or over about 30 million; a country list holds the 197 countries (193 UN members and Vatican City,
  Palestine, Taiwan, Kosovo; no dependencies).
- **`definition`** when the figure needs it: a city's population means three things (the city, its urban area, its
  metro), so a city question says which the list uses ("its whole urban area, UN figures for 2025").
- **`fact`** (optional): a sentence about the target or its answers, from the list's page. The best answers are the
  reveal, so a question can do without.
- **`verified: false` and a `note`** while a question waits for its list or a judge: the note says what the judge
  checks. The game leaves a question out while its list isn't there.

**Stable and safe:** an answer that stays put, plain about what's counted without background knowledge (the Sydney
Opera House's roof tiles were dropped: the big panels or the single tiles?). No live counts (followers, streams, net
worth), nothing that changes month to month, nothing gory or political. A dated figure is fine when the date is in the
`definition` ("2023").

**The bank's mix:** at least 40 questions (judging drops weak ones) over at least 8 kinds, no kind more than 9 in 50,
at least 12 easy openers, and a spread of estimate magnitudes from under 10 to billions (counting the unit's scale word:
86 billion neurons is in the billions; a percent or a year is no magnitude). No more than one in five how tall / how
heavy (a warning for now). Each game plays one percent, one year and one name-it round, and holds back the last 3
games' questions while the bank has others, so aim for at least 10 of each round; with fewer, the same ones come back
game after game. A name-it question counts toward its kind (`places` for countries and cities) like any other.

**Fetching:** Wikipedia's normal page HTML through `scripts/wiki.ts` (1.5 s between requests, one at a time, cached
in `.cache/wiki`), or another reputable page, fetched one at a time.

**Check:** `NODE_NO_WARNINGS=1 npx tsx scripts/fathom/check.ts` checks all of the above that a script can (shape,
unique ids, kinds, rounds and their units, a percent's 0 to 100, a year's whole four digits at least 10 years ago and
its "In what year" or "When", a typical value only on an estimate and only one of the list, `verified` a boolean,
positive finite answers of at most 6 digits before the point, https sources, one question ending in "?", the unit kept
out of it, answers not given away (a number standing alone, not inside a longer one: "300.12" doesn't state 300; a
year by any other question's text), the mix), prints the count by round and the how tall / how heavy share, and warns
past one in five. A name-it question is checked against its list: it asks "Name a ...", names the list's noun, takes
its unit, answer and source from the list, its target fits the list's scoring, its `except` is on the list, and at
least 3 answers score 70 or more; one whose list isn't there yet passes only while `verified` is false, with a warning.
Every list a question uses is checked too (`listMisses`): each name and alias reads back as its entry, and names
everyone uses for the same thing (UK and Britain, Holland, Czechia, DRC, East Timor, Bombay, Saigon, NYC:
`SAME_THING`) register wherever one of them is on the list.
`npm test` runs it on the real file (`scripts/fathom/check.test.ts`). Truth, fairness, the bar and the typical miss are
on the writer and the judge.

## Judging questions

Every question is judged before players see it, by a `fathom-judge` agent (`.claude/agents/fathom-judge.md`) that
didn't write it. The judge plays it as a curious 18-35 player who isn't a specialist, opens its source, and gives each
question one verdict: **keep**, **fix** (it fixes the question in place) or **drop**.

The judge checks, in this order, and stops at the first fail:

1. **The bar: all three tests** (above). Ask each one out loud and answer it before reading the answer.
   - *Familiar subject?* Would almost everyone have seen it or heard of it? A specific obscure case of a familiar
     thing fails ("a bank card's height": everyone has one, nobody pictures its size; a named rare animal). Drop.
   - *A way in?* Write the reasoning a curious player would use, from what they already know, to land within about 3x
     (an estimate), about 20 to 30 points (a percent: 20 on a small share, 30 near the middle) or about 1.8x of how
     long ago (a year: some 25 years after or 45 before an event 60 years ago), each about 25 points' worth. If there
     is none, it is a know-it-or-don't question: drop ("How long is the Trans-Siberian Railway?": a famous name, but
     nothing to reason from; an atom's width; an obscure count). Fame of the subject is not a way in.
   - *A reveal worth it?* Does the answer surprise or teach, and does the fact explain the number? A fact beside the
     point is a fix (from the source); a dull administrative number is a drop.
2. **One clear answer.** The question, definition and unit pin down a single number, and the source states it (or
   states it exactly enough). Sources that disagree by more than 1.5x on an estimate, 3 points on a percent or a year
   on a year, or a range passed off as a point, mean fix or drop.
3. **The round fits.** An estimate: the unit a person would answer in, scaled so the answer has at most 6 digits
   before the decimal point ("million people", kilometres for countries apart). A percent: a share of a plain whole,
   0 to 100, not near either end. A year: one event, one year, four digits, not stated in any other question. A
   question in the wrong round is a fix (a share asked as an estimate in "times" is a percent).
4. **The thing measured is clear** to someone who has never seen it: counting the parts of something (tiles, panels,
   bricks, windows) is a drop unless anyone would picture the same part at the same size. The owner on "How many tiles
   cover the roof shells of the Sydney Opera House?" (answer 1,056,006; he guessed 350): "I didn't know what it meant,
   the large tiles or the individual ones; it requires too many assumptions and background knowledge and isn't
   satisfying."
5. **Stable and dated.** It won't change from month to month; a yearly figure says its year.
6. **Fair, short wording.** Plain, dry English, about 12 words or fewer (two lines on a phone), no trick or gotcha
   definitions. Question and definition together stay within 100 characters, so LOCK IN stays above a phone keyboard
   (`check.ts` enforces it).
7. **Safe and fresh.** Nothing gory, political or about a private person, and not a near-copy of another question in
   the bank (same subject and measure).
8. **The how tall / how heavy share.** Count them (`check.ts` prints the share). While the bank is over one in five,
   a how tall / how heavy question has to beat the others on all three tests to stay: the plainer ones go first.
9. **A name-it question: type every obvious answer to the question; each must register.** Play it at #fathom with
   its list there. Write down the answers a curious player would try (the well-known countries near the target, their
   short forms and old names: "UK", "USA", "Holland", "Burma", "Bombay"), type each, and check it locks as the right
   thing, or goes in the box or offers a choice that includes it. One that says "Not one we know." is a missing alias
   (the list's, for the data agent) or a question to drop. Then type a few wrong kinds (a city, a territory, a US
   state) and check each says what it is and costs nothing. Check the target against the list's page (the yardstick's
   own figure, the list's measure in the definition), and that the best answers the reveal shows are fair ones.

The owner's taste, from playing the beta: he liked blood in a body, the Eiffel Tower, a giraffe, New York City's
population; units must be the obvious ones; scores are plain closeness, one plain rule for each round; and too many
how tall / how heavy questions make a dull game.

The judge records each verdict in `scripts/fathom/verdicts.json`:
`{ "<id>": { "verdict": "keep" | "fix" | "drop", "why": "one line", "judgedAt": "YYYY-MM-DD" } }`. The `why` names the
test that failed, for a drop ("no way in: know it or don't"). A fix changes only wording, unit, round, definition or
fact, always from the source; it never invents an answer. A dropped question is removed from
`public/fathom/questions.json` and kept in the verdicts file, so it isn't written again.
