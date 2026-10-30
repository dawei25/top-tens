# The list judge

Before a list runs as **Today's list** or **Today's Blitz**, a judge reviews its built puzzle the way a player would
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
   recognized in the replay?
6. **Score and decide** (below), then write the verdict file.

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

- **`daily-list`**: recognizability >= 4, curve >= 3, fairness >= 3, data >= 4, and the casual simulation finds at
  least 4 of the 10 without running out of lives.
- **`daily-blitz`**: Blitz-ready, blitzDepth >= 4, data >= 4, and the casual Blitz simulation scores 12+ answers.
  A list can qualify for both; say which it suits better.
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
  "summary": "One or two plain sentences a person can read in five seconds.",
  "reasons": ["short bullet", "short bullet"],
  "fixes": ["precise data fix for the rebuild queue, if any"]
}
```

`blitzCasual` is null when the list isn't Blitz-ready. Keep `summary` and `reasons` short and plain, and no em
dashes.

## How the schedule uses verdicts

`scripts/schedule.ts` only schedules **judged** lists. Today's list comes from `daily-list` verdicts and Today's
Blitz from `daily-blitz` verdicts (or `alsoBlitz`), highest priority first, rotating categories, and never the same
list as the day's daily. Lists without a verdict, or judged `free-play`, stay in random play and the archive.
