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
  `million`, `billion` and `trillion`; prefer the one people use for that size (`billion trees`, 3,040, over
  `trillion trees`), and never one the answer is under 1 of. A player who types the whole amount anyway ("8,800,000",
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

**The bank's mix:** at least 50 questions over at least 8 kinds, no kind more than 9 in 50, at least 12 easy
openers, and a spread of magnitudes from under 1 to billions (counting the unit's scale word: 86 billion neurons is in
the billions).

**Fetching:** Wikipedia's normal page HTML through `scripts/wiki.ts` (1.5 s between requests, one at a time, cached
in `.cache/wiki`), or another reputable page, fetched one at a time.

**Check:** `NODE_NO_WARNINGS=1 npx tsx scripts/fathom/check.ts` checks all of the above that a script can (shape,
unique ids, kinds, typical values, positive finite answers of at most 6 digits before the point, https sources, one
question ending in "?", the unit kept out of it, answers not given away, the mix), and `npm test` runs it on the real
file
(`scripts/fathom/check.test.ts`). Truth, fairness and the typical miss are on the writer.
