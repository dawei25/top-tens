/**
 * Today's Fathom against everyone who played it: "you did better than 81% of players today", with the day's totals as
 * a curve. Every player gets the same ten questions on a day, so their totals (0 to 1,000) compare directly.
 *
 * Until real players have played a day, a simulated crowd stands in: a right-skewed, roughly normal spread around the
 * day's expected total (most players near it, a longer tail of people who do really well). It counts as
 * ESTIMATE_WEIGHT (30) virtual players, and each real player's total joins it, as lists blend their estimate with real
 * first tries (src/net/crowd.ts, docs/BACKEND.md "How the averages blend"): nothing switches at a player count, 30
 * real players weigh as much as the simulation, 300 make the curve about 91% real. The real totals come from
 * fathom_day_stats (src/net: useFathomDay); without a backend, or before anyone has played, the curve is the simulation.
 *
 * Pure and deterministic: no Math.random, the same counts for the same day every time. docs/FATHOM.md, "Where you
 * stand", has the numbers.
 */
import { blendCounts, ESTIMATE_WEIGHT, type CrowdStats } from "../net/crowd";
import { FATHOM_BIN, FATHOM_BINS, FATHOM_MAX_TOTAL, totalBin } from "../net/fathom";
import { roundOf, type FathomQuestion, type Round } from "./fathom";
import { percentile } from "./par";

export { FATHOM_BIN, FATHOM_BINS, totalBin };

/**
 * What a typical casual player (18-35, curious, not a specialist) scores on a question, by its round: the
 * simulation's proxy for a day, summed over its ten. An estimate from the writers' typical miss (`typical` in
 * questions.json: about 2.3x on the questions that aren't openers, which scores about 35); a percent, a year and a
 * name-it round score more for the same reasoning (points off count, an event's age is a way in, a name-it round
 * takes any of several good answers).
 */
export const EXPECTED_POINTS: Readonly<Record<Round, number>> = { estimate: 35, percent: 55, year: 55, name: 60 };
/** An easy question (a game's opener, where most people have a rough anchor; typical miss about 1.5x), any round. */
export const EXPECTED_EASY = 65;

/** A question's expected points: EXPECTED_EASY when it's easy, else its round's. */
export const expectedPoints = (q: Pick<FathomQuestion, "round" | "easy">): number => (q.easy ? EXPECTED_EASY : EXPECTED_POINTS[roundOf(q)]);

/**
 * A day's expected total: its questions' expected points, summed. The usual day (an easy opener, four estimates, two
 * percents, two years, a name-it round) expects 485.
 */
export const expectedTotal = (questions: readonly Pick<FathomQuestion, "round" | "easy">[]): number =>
  questions.reduce((sum, q) => sum + expectedPoints(q), 0);

/**
 * The simulated crowd's spread: a two-piece normal curve, its standard deviation this many points below its peak...
 * Twice the five-question game's 70 and 120: a player's knack carries across a day's questions, so ten of them spread
 * totals about twice as far, on a scale twice as long (the same curve, as a share of the maximum).
 */
export const SPREAD_BELOW = 140;
/** ...and this many above it, so the top tail is the longer one. */
export const SPREAD_ABOVE = 240;
/** The expected totals the simulation centres on are kept to this range (every real day's is well inside it). */
const CENTRE_MIN = 200;
const CENTRE_MAX = 800;

/** The standard normal's cumulative distribution (Abramowitz and Stegun 7.1.26, within 1.5e-7). */
function phi(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const tail = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? 1 - tail / 2 : tail / 2;
}

/** The two-piece normal's cumulative distribution at x, peaking at `peak`. */
function spread(x: number, peak: number): number {
  const both = SPREAD_BELOW + SPREAD_ABOVE;
  return x < peak
    ? ((2 * SPREAD_BELOW) / both) * phi((x - peak) / SPREAD_BELOW)
    : SPREAD_BELOW / both + ((2 * SPREAD_ABOVE) / both) * (phi((x - peak) / SPREAD_ABOVE) - 0.5);
}

/** Totals run 0 to 1,000: whole numbers, so each bin's edges sit half a point out (0-9 is -0.5 to 9.5). */
const LOW = -0.5;
const HIGH = FATHOM_MAX_TOTAL + 0.5;

/** The share of the curve, cut to 0-1,000, below x. */
const below = (x: number, peak: number) => (spread(x, peak) - spread(LOW, peak)) / (spread(HIGH, peak) - spread(LOW, peak));

/**
 * Where the curve peaks so that half the simulated players score under `centre`: about 60 points under it (the curve
 * is nearly flat between the two).
 */
function peakFor(centre: number): number {
  let lo = centre - 300;
  let hi = centre + 300;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (below(centre, mid) > 0.5) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * The simulated crowd for a day expecting `expected` (expectedTotal), as ESTIMATE_WEIGHT virtual players spread over
 * the FATHOM_BINS bins (fractions: they add up to exactly 30). Half of them score under the expected total, the
 * middle 80% from about 220 under it to 260 over, and the mean is about 10 over it; nothing outside 0-1,000.
 */
export function simulatedCounts(expected: number): number[] {
  const peak = peakFor(Math.max(CENTRE_MIN, Math.min(CENTRE_MAX, expected)));
  const edge = (i: number) => (i <= 0 ? LOW : i >= FATHOM_BINS ? HIGH : i * FATHOM_BIN - 0.5);
  const shares = Array.from({ length: FATHOM_BINS }, (_, i) => below(edge(i + 1), peak) - below(edge(i), peak));
  const sum = shares.reduce((a, b) => a + b, 0);
  return shares.map((s) => (ESTIMATE_WEIGHT * s) / sum);
}

/**
 * The day's players to draw and rank against: the simulated crowd (ESTIMATE_WEIGHT virtual players) plus the real
 * players' totals that day (fathom_day_stats: `real.counts` in the same bins). No real players (null, or n 0): the
 * simulation alone. They add up to ESTIMATE_WEIGHT + real.n.
 */
export function dayCounts(expected: number, real?: CrowdStats | null): number[] {
  return blendCounts(simulatedCounts(expected), real);
}

/** Where a day's total stands. */
export interface FathomStanding {
  /**
   * The share of the day's players (the blend) the total beats, 0 to 99: game/par's percentile on its bin (everyone
   * in a lower bin, plus half of those in its own). Never 100: nobody beats everyone, a player ties with themselves.
   */
  p: number;
  /** Real players counted (the simulated 30 aren't). */
  n: number;
}

/** "you did better than 81% of players today": where `total` stands among the day's players (dayCounts). */
export function dayStanding(expected: number, real: CrowdStats | null | undefined, total: number): FathomStanding {
  const p = percentile(dayCounts(expected, real), totalBin(total));
  return { p: Math.min(99, p), n: real?.n ?? 0 };
}
