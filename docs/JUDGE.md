# The list judge

Before a list runs as **Today's list**, a judge reviews its built puzzle the way a player would
meet it, and decides where it belongs. Dailies are the front door of the game: everyone plays the same one, so a
daily must be fun for a typical player, not just correct.

The judge is an agent (`.claude/agents/list-judge.md` in this repo; any session can run it with this file as its
brief). One judge reviews one list. Judges never see each other's verdicts.

## The player we judge for

An English-speaking adult, 18-35, curious, follows the news and pop culture casually, not a specialist in the
topic. Think a college student or young professional playing on their phone. Not a geography bee champion, not a
sports statistician.

## Procedure

1. **Read the build.** `NODE_NO_WARNINGS=1 npx tsx scripts/judge/packet.ts <id>` prints what the player sees, the
   top 10 with aliases, the wider answer pool and the Blitz stats.
2. **Predict before you look closely.** Before studying the top 10, write down how *you* would expect a typical
   player to understand the prompt, and what they'd type first. This catches prompts that invite the wrong answers.
3. **Simulate two players.** Write the guesses each would actually type, in order, with realistic spelling (short
   forms, lowercase, common misspellings). Then replay them through the real matcher:
   `NODE_NO_WARNINGS=1 npx tsx scripts/judge/try.ts <id> "guess" "guess" ...`
   - **Casual:** 12-15 guesses, what comes to mind in about two minutes with no special knowledge.
   - **Fan:** 15-20 guesses, someone who likes this topic and knows it reasonably well.
   Write the guesses honestly *before* checking them against the top 10; don't tune them to the answer key.
4. **For Blitz-ready lists, simulate a 90-second Blitz** for the casual player: list everything they could name
   quickly (aim for honesty, not volume) and replay it. Count how many score.
5. **Check the data.** Does the top 10 match what a well-informed person would expect for this prompt? Are there
   definition traps (dependencies counted as countries, a ranking by an unexpected measure), stale or odd values,
   duplicate or garbled names, junk aliases (alias text glued together, redirects that are not names of the thing,
   such as "1937 Nanga Parbat tragedy" for a mountain)? Were obvious ways of typing a top-10 answer *not*
   recognized in the replay? Type the list's subject and its categories alone ("tour", "toyota", "china" on banks):
   they must never hand over top-10 answers. On a one-year ranking ("of 2026"), only recent near misses should cost
   a life; past stars from old years are free. Try the famous things of the same kind that aren't on the list
   (crossbreeds on dog breeds, non-Netflix shows): they should be free, not corrected into an answer.
   **Compare with the bank's closest list** (`public/puzzles/index.json`): a list of the same kind of answers that a
   player would find weaker (fewer famous names, the same people again) is `reject`, however clean its data. The
   owner dropped "Most-followed Facebook pages" as a worse Instagram list.
   **Read `docs/OWNER_PICKS.md` first:** the owner's picks and passes, with his reasons, are the taste to judge by.
6. **Check the reveal.** Every top-10 answer should show a fun fact, and your casual player's misses should show a
   rank or a figure. A miss that only says "isn't in the top 10" while the page has numbers for it is a `fixes` item.
   When players answer by something other than the entry's name (the artist of a tour), the fact names it.
   On a list of places, every fact says where the place is: its country, or its state or province on a one-country
   list (the owner, on national parks), the planet a moon orbits; and it is the right place, as the source table
   gives it. validate.ts only checks that a place is named.
7. **Score and decide** (below), then write the verdict file. Keep an `ownerVeto` already in the file: it is the owner's call
   and outranks the decision (the list never runs as Today's list).

## Scores (1 to 5)

| Score | 5 means | 1 means |
|---|---|---|
| `recognizability` | a typical player knows most of the top 10 by name | they know one or two at most |
| `curve` | a good spread: 3-5 gimmes, a few gettable with thought, 1-2 stretch answers that feel fair when revealed | all gimmes (boring) or almost all unknown (hopeless) |
| `fairness` | a plausible guess outside the top 10 feels like a near miss you learn from ("Japan is #11") | the prompt invites a whole class of famous wrong answers that each cost a life |
| `data` | correct, current, clearly defined, clean names and aliases | wrong, stale, ambiguous or messy |
| `fun` | surprises, debate, "oh I forgot that one" moments | a rote list nobody cares about |
| `blitzDepth` | a casual player names 15+ scoring answers in 90 s (score 0 if not Blitz-ready) | they run dry after 3-4 |

## Decisions

Pick the best fit, in this order:

**One daily.** Today's list is the only daily (Today's Blitz was retired, owner Nov 9); Blitz is free play. A good
list is about knowing the top 10 and its order, a good Blitz about breadth (lots of names a casual player can fire off
that all score). The owner's target for Today's list: a typical player averages **5 to 6 out of 10**.

- **`daily-list`** (Today's list): all of
  - recognizability >= 4: most adults could name 5 of these without being fans of the topic (Broadway shows, NHL
    scorers and national parks fail this; they are free play);
  - the title and prompt say what the player is naming ("Countries emitting the most CO2", not "Biggest CO2
    emitters"), and by what measure when it isn't the one a player would assume ("most certified units", not
    "best-selling", when streams count and Drake beats the Beatles); if not, it's `fix-first`;
  - curve >= 3, fairness >= 3, data >= 4;
  - the casual simulation finds **6 to 8** of the 10 before the game ends. (A game short of 10/10 always ends at
    zero lives, so count what was found by then; running out is normal, not a fail.) `scripts/judge/par.ts` turns
    the casual score into an estimated crowd that bunches toward the middle (1.5 + 0.45 x casual for the typical
    player): 6 found lands the average near 5, 8 near 6. Below 6 is too hard for a daily, 9-10 too easy. How fast
    famous misses burn lives belongs in `fairness`, not here;
- **Blitz** (free play): any Blitz-ready list whose verdict scores blitzDepth >= 4, data >= 4 and recognizability
  >= 4 (and isn't `reject` or `fix-first`), whatever its list decision: a list too easy or too punishing as a classic
  (US states by GDP, world cities) can be a great Blitz. Simulate the casual Blitz honestly so blitzDepth means
  something. `daily-blitz` remains for a list that is only good as a Blitz.
- **`free-play`**: correct and playable but too niche or too hard for a daily; fine for random rolls, Random Blitz
  and the archive.
- **`fix-first`**: would qualify, but has data problems to fix in the next rebuild (list them precisely).
- **`reject`**: broken, misleading, or no fun at any level.

Also give `priority` from 1 to 10: how strongly you'd want this as a daily soon (10 = run it this week).

## Verdict file

Write `scripts/judge/verdicts/<id>.json`:

```json
{
  "id": "countries-population",
  "judgedAt": "2026-10-30",
  "decision": "daily-list",
  "alsoBlitz": true,
  "priority": 9,
  "scores": { "recognizability": 5, "curve": 4, "fairness": 4, "data": 5, "fun": 4, "blitzDepth": 5 },
  "casual": { "found": 7, "livesLost": 1, "guesses": 13 },
  "fan": { "found": 9, "livesLost": 1, "guesses": 16 },
  "blitzCasual": { "scored": 24, "named": 26 },
  "difficulty": 2,
  "tags": ["geography", "population"],
  "audience": "anyone",
  "summary": "One or two plain sentences a person can read in five seconds.",
  "reasons": ["short bullet", "short bullet"],
  "fixes": ["precise data fix for the rebuild queue, if any"]
}
```

`blitzCasual` is null when the list isn't Blitz-ready. Keep `summary` and `reasons` short and plain, and no em
dashes.

## Sorting fields (every verdict)

Every verdict also carries, for sorting the free-play pool and, later, letting players roll by interest:

- `difficulty`: 1 (anyone gets most of it) to 5 (enthusiasts only), for a typical player.
- `tags`: 2-4 lowercase topic tags a player might pick a list by: broad first, then specific. For example
  `["sports", "basketball", "nba"]`, `["history", "war"]`, `["geography", "europe"]`, `["music", "pop"]`.
- `audience`: one short phrase for who will love it ("anyone", "sports fans", "history buffs", "film nerds").

## Triage mode

For sorting many lists at once, a lighter pass. Same honesty, less writing:

1. Read the packet.
2. Simulate one **casual** player (12-15 guesses) and replay them. If the list is Blitz-ready, also do a quick 90 s
   casual Blitz.
3. Simulate the **fan** only when the list might be `daily-list` (to check the curve).
4. Check the data as in step 5, briefly.
5. Write the full verdict file (all scores, decision, sorting fields). Keep `reasons` to two or three bullets and
   `fixes` to real problems.

A judge in triage mode may handle several lists one after another, but must judge each on its own and never compare
them to each other in a verdict.

## How the schedule uses verdicts

`scripts/schedule.ts` only schedules **judged** lists. Each day gets a `daily-list` verdict for Today's list (new
lists first, which wait out of random play for their debut, then rotating categories and highest priority). Today's
list runs only once. The scheduler still writes a `blitz` field for every day (from when there was a Today's Blitz);
only old `#dailyblitz-<date>` links read it, and that list stays ordinary free play. A judge who sends a new (`debut`)
list to free play only says so in `fixes`: its flag must go, or it waits out of random play for good. Lists without a verdict, or judged `free-play`, stay in random play and the archive.
