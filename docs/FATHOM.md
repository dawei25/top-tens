# Fathom

An estimation mini-game (hidden at `#fathom`): each game shows 5 questions, the player types a number, and the score
is plain closeness, by one rule for each round (`scoreFor`, `src/game/fathom.ts`). The questions live in
`public/fathom/questions.json`.

## The rounds

A question's `round` says how it is asked and scored (absent means an estimate). `kind` is its topic, apart from this.

| Round | The player types | Points | The rule on screen | The miss |
|---|---|---|---|---|
| `estimate` | a number in the question's unit | 100 x (1 - d)^2, d = \|log10(guess / answer)\|; within 1% spot on, 100 | "Half or double the answer scores about 50. Ten times off scores 0." | "30% low", "3x too high" |
| `percent` | 0 to 100: "71", "71%", "71.5" | 100 - 3 x points off, never under 0; within half a point spot on, 100 | "Each point off costs 3, so 10 off scores 70." | "6 points low" |
| `year` | an AD year, up to four digits: "2007" | 100 - 5 x years off, never under 0; the exact year 100 | "Each year off costs 5, so 10 years off scores 50." | "3 years early" |

Why these: a ratio means nothing on a share or a date (65% for 71% is 9% off but 6 points; 2004 for 2007 is 0.06%
off), so those rounds score the distance the player thinks in. 3 a point puts Dead on (90+) within 3 points and Close
(70+) within 10; 5 a year puts Dead on within 2 years, Close within 6, and 20 years off at 0. Each rule names a miss and
what it scores, and the numbers agree (`fathom.test.ts`; UX.md 21). It shows on the first question of its round in a
game, before the answer (under LOCK IN when a phone has little height), and the results show the rule of every round
played. Whatever reads "spot on" scores 100, in every round. The bands, the sonar (its edges where the round scores
0: 10x off, 33 points, 20 years), the share text, the sound and the celebration work the same for every round.

The field: a decimal keypad for an estimate and a percent ("%" beside it for a percent), a plain number pad for a year,
which never groups its digits ("2007", not "2,007"). A percent of 0 is a fair guess; past 100 says "0 to 100, please."
A year with a fraction says "A whole year, please.", five digits "A year has four digits."

## A game

Five rounds (`GAME_ROUNDS`): two estimates, a percent, a year, and a fifth that will be a name-it round (an estimate
until it exists). No timer. The first question is an easy one; the other four come in a random order. Within that, no
two of the same kind, at most two how tall / how heavy questions, and none from the last 3 games while the bank has
others (then the oldest come back first). A round the bank has none of is played as an estimate, so a small bank never
breaks a game.

**A how tall / how heavy question** (`isSizeQuestion`): an estimate whose unit is a length or a mass (any scale word in
front) and that asks how tall, long, high, deep, wide, big or heavy something is, or what it weighs ("How tall is the
Eiffel Tower?", "How long is a marathon?", "How much does an ostrich egg weigh?", "What weight of tomatoes..."). Not
one: a distance ("How far away is the Moon?"), an amount used or grown ("How much tea does Turkey get through?", "How
much can bamboo grow in a day?"), a duration, a count, an area, a percent or a year. The draw takes at most two a game;
the bank should hold no more than one in five (`check.ts` reports it as a warning until the rebuilt bank lands; the
old bank had 43 of 94).

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
- **`round`** (optional): `percent` or `year`; leave it out for an estimate. The rules for each are below.
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

**A percent question** (`round: "percent"`, unit `percent`): a share of a whole everyone can picture (the air, the
Moon's face, people), answered 0 to 100 as the source states it (20.95 is fine; the game shows "20.95%"). Ask "How
much of...?" or "What share of...?", never "What percent of...?" (the "%" is beside the field). The way in is the
whole: you can reason from a part you know (one face of the Moon, the left-handers in your class). An answer within a
few points of 0 or 100 leaves little to reason about; prefer one in between. A share that changes year to year carries
its year in the definition.

**A year question** (`round: "year"`, unit `year`): one event with one year, a whole AD year of four digits (1000 to
this year), as the source dates it. Ask "In what year...?" or "When...?". No spans ("the Middle Ages"), no "c. 1500",
nothing the source dates two ways. The way in is a date the player already has: their own life, a war, an invention,
something before or after it ("before the iPhone, after the internet"). The fact puts the year in context, never a
second date that gives it away. The year must not appear in any other question's question, definition or fact
(`check.ts`: two questions in one game would give it away).

**Stable and safe:** an answer that stays put, plain about what's counted without background knowledge (the Sydney
Opera House's roof tiles were dropped: the big panels or the single tiles?). No live counts (followers, streams, net
worth), nothing that changes month to month, nothing gory or political. A dated figure is fine when the date is in the
`definition` ("2023").

**The bank's mix:** at least 40 questions (judging drops weak ones) over at least 8 kinds, no kind more than 9 in 50,
at least 12 easy openers, and a spread of estimate magnitudes from under 1 to billions (counting the unit's scale word:
86 billion neurons is in the billions; a percent or a year is no magnitude). No more than one in five how tall / how
heavy (a warning for now). Each game plays one percent and one year, and holds back the last 3 games' questions while
the bank has others, so aim for at least 10 of each round; with fewer, the same ones come back game after game.

**Fetching:** Wikipedia's normal page HTML through `scripts/wiki.ts` (1.5 s between requests, one at a time, cached
in `.cache/wiki`), or another reputable page, fetched one at a time.

**Check:** `NODE_NO_WARNINGS=1 npx tsx scripts/fathom/check.ts` checks all of the above that a script can (shape,
unique ids, kinds, rounds and their units, a percent's 0 to 100, a year's whole four digits no later than this year and
its "In what year" or "When", a typical value only on an estimate and only one of the list, `verified` a boolean,
positive finite answers of at most 6 digits before the point, https sources, one question ending in "?", the unit kept
out of it, answers not given away (a number standing alone, not inside a longer one: "300.12" doesn't state 300; a
year by any other question's text), the mix), prints the count by round and the how tall / how heavy share, and warns
past one in five.
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
     (an estimate), 25 points (a percent) or 15 years (a year), each about 25 points' worth. If there is none, it is a
     know-it-or-don't question: drop ("How long is the Trans-Siberian Railway?": a famous name, but nothing to reason
     from; an atom's width; an obscure count). Fame of the subject is not a way in.
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

The owner's taste, from playing the beta: he liked blood in a body, the Eiffel Tower, a giraffe, New York City's
population; units must be the obvious ones; scores are plain closeness, one plain rule for each round; and too many
how tall / how heavy questions make a dull game.

The judge records each verdict in `scripts/fathom/verdicts.json`:
`{ "<id>": { "verdict": "keep" | "fix" | "drop", "why": "one line", "judgedAt": "YYYY-MM-DD" } }`. The `why` names the
test that failed, for a drop ("no way in: know it or don't"). A fix changes only wording, unit, round, definition or
fact, always from the source; it never invents an answer. A dropped question is removed from
`public/fathom/questions.json` and kept in the verdicts file, so it isn't written again.
