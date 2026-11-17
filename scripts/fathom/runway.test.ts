// Today's Fathom's runway: public/fathom/daily.json must reach a week past today. Past its last day the game makes up
// a date-seeded day (dayFor, src/game/fathom-daily.ts) that asks questions again. This runs in `npm run verify` (and
// `npm test`), never in `verify:deploy` (`vitest run src`): a short week never blocks a deploy.
import { describe, expect, it } from "vitest";
import { addDays } from "../../src/game/fathom-daily";
import { loadSchedule } from "./daily";

/** Days the committed schedule must reach past today. */
const RUNWAY_DAYS = 7;

const pad = (n: number) => String(n).padStart(2, "0");
const now = new Date();
const TODAY = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

describe("Today's Fathom's runway (public/fathom/daily.json)", () => {
  it(`has a day for each of the next ${RUNWAY_DAYS} days`, () => {
    const dates = new Set(loadSchedule().map((e) => e.date));
    let days = 0;
    while (dates.has(addDays(TODAY, days + 1))) days++;
    const left = days ? `${days} day${days === 1 ? "" : "s"} left after today (${TODAY}), through ${addDays(TODAY, days)}` : `no days left after today (${TODAY})`;
    expect(
      days,
      `Today's Fathom has ${left}; it needs ${RUNWAY_DAYS}. Past the last day the game repeats questions. Run: ` +
        `NODE_NO_WARNINGS=1 npx tsx scripts/fathom/daily.ts --days 14 (it says how far the bank goes; if it runs out, ` +
        `add questions: docs/FATHOM.md)`,
    ).toBeGreaterThanOrEqual(RUNWAY_DAYS);
  });
});
