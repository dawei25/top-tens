# Fathom

An estimation mini-game: each game shows 5 questions, the player types a number, and the score compares their miss
with how far off people typically are. The questions live in `public/fathom/questions.json`.

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
```

- **`id`**: kebab-case, unique.
- **`kind`**: one of body, animals, landmarks, places, space, food, everyday, nature, science, sports, culture,
  lists. `lists` is for figures from TENtacle's own lists (`public/puzzles/*.json`); about 6 in 50 at most.
- **`question`**: plain, dry, one question ending with "?", naming exactly what is measured. The unit stays out of it:
  the game shows `unit` beside the input. A count names what it counts once, right after "How many" ("How many keys
  does a modern piano have?", unit `keys`); a measure never does ("How tall is it in metres?" is wrong). No trick
  wording, and nothing in the question or the definition that gives the number away. Keep it short: the question names
  the thing ("How tall is the Statue of Liberty?"), the definition says exactly what is measured ("ground to torch tip,
  pedestal included"), and its words match the measure ("How long" for a card's long side, not "How wide"). With a
  phone's keyboard up, the bank's five longest questions must still show whole above the field (`e2e/fathom.e2e.cjs`).
- **`unit`**: plural, lower case (`degrees Celsius` is the one capital), metric: `metres`, `litres`, `kilograms`,
  `kilometres`, `square kilometres`, `minutes`, `people`, `times`... `years` only as a duration. A unit of measure
  must be one the game reads (`UNITS` in `src/game/fathom.ts`): players may type it after the number in any form
  ("343 m/s", "390000 km2"), and other units of its kind are converted exactly ("1.5 km" in metres); anything else
  counts things. `src/game/fathom.test.ts` reads every answer back typed with its unit.
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
- **`typical`**: the typical miss, as a ratio: half of casual 18-35 players would land within this many times of the
  answer. One of 1.3, 1.5, 2, 3, 5, 10, 30. Be honest: a giraffe's height is about 1.3 to 1.5, blood in a body 2, the
  number of trees on Earth 30.
- **`easy`**: true for a good opener, where most people have a rough anchor (the Eiffel Tower, a marathon).

**What makes a good question:** surprising but fair ("the answer is bigger than you'd think" is good), with an answer
that stays put, and plain about what's counted without background knowledge (the Sydney Opera House's roof tiles were
dropped: the big panels or the single tiles?). No year questions ("In what year..."), no percentages, no live counts (followers, streams, net worth),
nothing that changes month to month, nothing gory or political. A dated figure is fine when the date is in the
`definition` ("2023").

**The bank's mix:** at least 40 questions (judging drops weak ones) over at least 8 kinds, no kind more than 9 in 50, at least 12 easy
openers, and a spread of magnitudes from under 1 to billions (counting the unit's scale word: 86 billion neurons is in
the billions).

**Fetching:** Wikipedia's normal page HTML through `scripts/wiki.ts` (1.5 s between requests, one at a time, cached
in `.cache/wiki`), or another reputable page, fetched one at a time.

**Check:** `NODE_NO_WARNINGS=1 npx tsx scripts/fathom/check.ts` checks all of the above that a script can (shape,
unique ids, kinds, typical values, positive finite answers of at most 6 digits before the point, https sources, one
question ending in "?", the unit kept out of it, answers not given away, the mix), and `npm test` runs it on the real
file
(`scripts/fathom/check.test.ts`). Truth, fairness and the typical miss are on the writer.

## Judging questions

Every question is judged before players see it, by a `fathom-judge` agent (`.claude/agents/fathom-judge.md`) that
didn't write it. The judge plays it as a curious 18-35 player who isn't a specialist, opens its source, and gives each
question one verdict: **keep**, **fix** (it fixes the question in place) or **drop**.

What a good question has, in the order the judge checks it:

1. **One clear answer.** The question, definition and unit pin down a single number, and the source states it (or
   states it exactly enough). Sources that disagree by more than 1.5×, or a range passed off as a point, mean fix or
   drop.
2. **A natural, typeable unit.** The unit a person would answer in (kilometres for countries apart, not metres or
   feet), scaled so the answer has at most 6 digits before the decimal point ("million people").
3. **Something to reason from.** A curious person can get within about 3× by thinking (a body, a building, a trip
   they can picture). Pure trivia nobody could approach (an atom's width, an obscure count) is a drop, however true.
   The thing measured must be clear to someone who has never seen it: counting the parts of something (tiles,
   panels, bricks, windows) is a drop unless anyone would picture the same part at the same size. The owner on "How
   many tiles cover the roof shells of the Sydney Opera House?" (answer 1,056,006; he guessed 350): "I didn't know
   what it meant, the large tiles or the individual ones; it requires too many assumptions and background knowledge
   and isn't satisfying."
4. **A reveal worth reading.** The answer surprises or teaches ("more than you'd think"); a dull administrative number
   is a drop. The fact relates to the number and never gives away another question's answer.
5. **Stable and dated.** It won't change from month to month; a yearly figure says its year.
6. **Fair, short wording.** Plain, dry English, about 12 words or fewer (two lines on a phone), no trick or gotcha
   definitions. Question and definition together stay within 100 characters, so LOCK IN stays above a phone keyboard
   (`check.ts` enforces it).
7. **Safe and fresh.** Nothing gory, political or about a private person, and not a near-copy of another question in
   the bank (same subject and measure).

The owner's taste, from playing the beta: he liked blood in a body, the Eiffel Tower, a giraffe, New York City's
population; units must be the obvious ones; scores are plain closeness, the same rule for every question.

The judge records each verdict in `scripts/fathom/verdicts.json`:
`{ "<id>": { "verdict": "keep" | "fix" | "drop", "why": "one line", "judgedAt": "YYYY-MM-DD" } }`. A fix changes only
wording, unit, definition or fact, always from the source; it never invents an answer. A dropped question is removed
from `public/fathom/questions.json` and kept in the verdicts file, so it isn't written again.
