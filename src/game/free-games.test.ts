import { describe, expect, it } from "vitest";
import type { BlitzRun, BlitzState } from "./blitz";
import type { DailyEntry } from "./daily";
import { FREE_GAMES_BEFORE_SIGN_IN, freeGamesPlayed, opensPlayedGame, signInToPlay } from "./free-games";
import type { ListRun } from "./history";
import type { GameState } from "./state";
import type { Saved } from "./storage";

const TODAY = "2026-11-14";
const empty: Saved = { games: {}, daily: {}, seenHelp: true };
/** Today's list is "today"; "old" ran on the 10th (back in free play), "later" runs on the 20th. */
const schedule: DailyEntry[] = [
  { n: 1, date: "2026-11-10", id: "old" },
  { n: 5, date: TODAY, id: "today" },
  { n: 11, date: "2026-11-20", id: "later" },
];
const run = (id: string, startedAt: number, daily?: number): ListRun => ({
  id, startedAt, finishedAt: startedAt + 60_000, status: "lost", found: [1], lives: 0, hints: 0, ...(daily ? { daily } : {}),
});
const guessed = { text: "everest", result: { kind: "correct" } } as unknown as GameState["log"][number];
/** A list game in the list's own save: under way (with `log` guesses taken), or finished. */
const game = (id: string, startedAt: number, o: Partial<GameState> = {}): GameState => ({
  puzzleId: id, found: [], lives: 5, log: [], status: "playing", startedAt, ...o,
});
const round = (startedAt: number): BlitzRun => ({ startedAt, endedAt: startedAt + 90_000, score: 120, hits: [] });
const live = (id: string, startedAt?: number): BlitzState => ({ puzzleId: id, hits: [], ...(startedAt ? { startedAt } : {}) });

const count = (s: Saved) => freeGamesPlayed(s, schedule, TODAY);
const ask = (s: Saved, signedIn = false, accounts = true) => signInToPlay(s, { schedule, today: TODAY, signedIn, accounts });

describe("the free-play counter", () => {
  it("counts finished free list games and Blitz rounds, each once", () => {
    expect(count(empty)).toBe(0);
    const done = game("a", 100, { status: "won", finishedAt: 200, log: [guessed] });
    const s: Saved = { ...empty, games: { a: done }, listRuns: [run("a", 100), run("b", 300)], blitzRuns: { c: [round(500), round(900)] } };
    // "a" is in its own save and in the history: one game.
    expect(count(s)).toBe(4);
  });

  it("counts a list game from its first guess the list takes, a clue or a give-up; an open alone doesn't count", () => {
    expect(count({ ...empty, games: { a: game("a", 100) } })).toBe(0);
    expect(count({ ...empty, games: { a: game("a", 100, { log: [guessed] }) } })).toBe(1);
    expect(count({ ...empty, games: { a: game("a", 100, { hints: [3], lives: 4 }) } })).toBe(1);
    expect(count({ ...empty, games: { a: game("a", 100, { status: "gave-up", finishedAt: 150 }) }, listRuns: [run("a", 100)] })).toBe(1);
  });

  it("counts a Blitz round once its clock started, under way or finished", () => {
    expect(count({ ...empty, blitzLive: { c: live("c") } })).toBe(0);
    expect(count({ ...empty, blitzLive: { c: live("c", 500) } })).toBe(1);
    // Left behind and then recorded (a later roll ends it): still the same round.
    expect(count({ ...empty, blitzLive: { c: live("c", 500) }, blitzRuns: { c: [round(500)] } })).toBe(1);
  });

  it("never counts a daily: today's, an archive day's, or a round of the old Today's Blitz", () => {
    const s: Saved = {
      ...empty,
      listRuns: [run("today", 100, 5), run("old", 200, 1)],
      dailyGames: { [TODAY]: game("today", 100, { status: "lost", finishedAt: 160 }) },
      blitzRuns: { m: [round(300), round(700)] },
      blitzDaily: { "2026-11-08": { id: "m", score: 120, answers: 0, startedAt: 300 } },
    };
    // The one Blitz round that wasn't that day's Today's Blitz is free play.
    expect(count(s)).toBe(1);
    // A daily under way keeps its game in the list's own save: today's, or an archive day's not finished yet.
    expect(count({ ...empty, games: { today: game("today", 100, { log: [guessed] }), old: game("old", 200, { log: [guessed] }) } })).toBe(0);
  });

  it("counts a free game under way on a list whose daily is done, or on a later day's list", () => {
    const locked = { "2026-11-10": game("old", 50, { status: "won", finishedAt: 90 }) };
    const s: Saved = { ...empty, dailyGames: locked, games: { old: game("old", 100, { log: [guessed] }), later: game("later", 200, { log: [guessed] }) } };
    expect(count(s)).toBe(2);
  });

  // A roll lands on an old daily's list as often as on any other (a day's list joins free play the next day), and its
  // game under way shares the list's save with that day's daily: the free one counts by the mark free play left on it
  // (the e2e suite caught a second free game going uncounted on the airports list, a past daily).
  it("counts a free game under way on an old daily's list by its free-play mark, never today's list", () => {
    const s: Saved = { ...empty, games: { old: game("old", 100, { log: [guessed] }), today: game("today", 200, { log: [guessed] }) } };
    expect(count(s)).toBe(0);
    expect(freeGamesPlayed(s, schedule, TODAY, new Set(["old:100"]))).toBe(1);
    // The mark names one game: a later game on the list (an archive daily, say) isn't it.
    expect(freeGamesPlayed(s, schedule, TODAY, new Set(["old:99"]))).toBe(0);
    expect(freeGamesPlayed(s, schedule, TODAY, new Set(["old:100", "today:200"]))).toBe(1);
    expect(signInToPlay({ ...s, listRuns: [run("a", 50)] }, { schedule, today: TODAY, signedIn: false, accounts: true, freeStarts: new Set(["old:100"]) })).toBe(true);
  });
});

describe("signing in to play", () => {
  const two: Saved = { ...empty, listRuns: [run("a", 100)], blitzLive: { c: live("c", 500) } };

  it(`lets ${FREE_GAMES_BEFORE_SIGN_IN} free games start, then asks`, () => {
    expect(FREE_GAMES_BEFORE_SIGN_IN).toBe(2);
    expect(ask(empty)).toBe(false);
    expect(ask({ ...empty, listRuns: [run("a", 100)] })).toBe(false);
    expect(ask(two)).toBe(true);
    expect(ask({ ...two, listRuns: [run("a", 100), run("b", 200), run("c", 300)] })).toBe(true);
  });

  it("never asks a signed-in player, or in a build without accounts", () => {
    const many: Saved = { ...empty, listRuns: Array.from({ length: 40 }, (_, i) => run(`l${i}`, i * 1000)) };
    expect(ask(many, true)).toBe(false);
    expect(ask(many, false, false)).toBe(false);
  });

  it("takes the limit as one number", () => {
    expect(signInToPlay(two, { schedule, today: TODAY, signedIn: false, accounts: true, limit: 3 })).toBe(false);
    expect(signInToPlay(two, { schedule, today: TODAY, signedIn: false, accounts: true, limit: 1 })).toBe(true);
  });

  it("dailies never count toward the limit", () => {
    const dailies: Saved = { ...empty, listRuns: [run("today", 100, 5), run("old", 200, 1), run("x", 300, 3)] };
    expect(ask(dailies)).toBe(false);
  });
});

describe("a visit that shows a game already played", () => {
  it("a list game under way resumes and a finished one shows its result; a fresh open is a new game", () => {
    expect(opensPlayedGame(empty, "list", "a")).toBe(false);
    expect(opensPlayedGame({ ...empty, games: { a: game("a", 100) } }, "list", "a")).toBe(false);
    expect(opensPlayedGame({ ...empty, games: { a: game("a", 100, { log: [guessed] }) } }, "list", "a")).toBe(true);
    expect(opensPlayedGame({ ...empty, games: { a: game("a", 100, { status: "lost", finishedAt: 200 }) } }, "list", "a")).toBe(true);
  });
  it("a Blitz round resumes once its clock started", () => {
    expect(opensPlayedGame({ ...empty, blitzLive: { c: live("c") } }, "blitz", "c")).toBe(false);
    expect(opensPlayedGame({ ...empty, blitzLive: { c: live("c", 500) } }, "blitz", "c")).toBe(true);
    // A finished round is in the history; the next visit is a new round.
    expect(opensPlayedGame({ ...empty, blitzRuns: { c: [round(500)] } }, "blitz", "c")).toBe(false);
  });
});
