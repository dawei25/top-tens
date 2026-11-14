import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  COMPARE_ROUNDS,
  compareArgs,
  compareKey,
  compareRound,
  FATHOM_BIN,
  FATHOM_BINS,
  FATHOM_GUESSES,
  FATHOM_MAX_TOTAL,
  FATHOM_PLAYS,
  fathomDayKey,
  fathomPlayArgs,
  guessArgs,
  invalidFathomPlay,
  invalidGuess,
  MAX_GUESS,
  parseCompare,
  parseFathomDay,
  totalBin,
  type FathomGuess,
  type FathomPlay,
} from "./fathom";
import { enqueue, Outbox, type OutboxData, type SendResult } from "./outbox";

const T = Date.UTC(2026, 10, 5, 12);
const guess = (over: Partial<FathomGuess> = {}): FathomGuess => ({ questionId: "eiffel-tower-height", guess: 300, at: T, ...over });

describe("a Fathom guess", () => {
  it("is checked as the database checks it", () => {
    expect(invalidGuess(guess())).toBeNull();
    expect(invalidGuess(guess({ guess: 0.0025 }))).toBeNull();
    expect(invalidGuess(guess({ guess: 2.5e12 }))).toBeNull();
    // 0% is a fair percent, and 0 land borders a fair name-it figure.
    expect(invalidGuess(guess({ questionId: "plastic-recycled", guess: 0 }))).toBeNull();
    expect(invalidGuess(guess({ questionId: "name-country-6-borders", guess: 0 }))).toBeNull();
    expect(invalidGuess(guess({ questionId: "Bad Id" }))).toBe("question id");
    expect(invalidGuess(guess({ questionId: "x".repeat(65) }))).toBe("question id");
    for (const bad of [-5, -1e-9, -Infinity, NaN, Infinity, MAX_GUESS, "300" as unknown as number, null as unknown as number]) {
      expect(invalidGuess(guess({ guess: bad })), String(bad)).toBe("guess");
    }
    expect(invalidGuess(guess({ at: NaN }))).toBe("at");
  });

  it("goes to submit_fathom_guess with this browser's id", () => {
    expect(guessArgs(guess({ guess: 1.5e9 }), "c-1")).toEqual({ p_question_id: "eiffel-tower-height", p_guess: 1.5e9, p_client_id: "c-1" });
  });

  it("asks fathom_compare with the round, the answer shown and this browser's id (left out of the crowd)", () => {
    expect(compareArgs("eiffel-tower-height", "estimate", 300, 330, "c-1")).toEqual({
      p_question_id: "eiffel-tower-height",
      p_round: "estimate",
      p_guess: 300,
      p_answer: 330,
      p_client_id: "c-1",
    });
    expect(compareArgs("name-country-6-borders", "name-steps", 0, 6, "c-1")).toMatchObject({ p_round: "name-steps", p_guess: 0, p_answer: 6 });
  });

  it("names each question's round as fathom_compare measures it: a name-it round by its list's scoring", () => {
    expect(compareRound({})).toBe("estimate");
    expect(compareRound({ round: "estimate" })).toBe("estimate");
    expect(compareRound({ round: "percent" })).toBe("percent");
    expect(compareRound({ round: "year" })).toBe("year");
    const nameIt = { list: "land-borders", noun: "country", nounPlural: "countries" };
    expect(compareRound({ round: "name", nameIt: { ...nameIt, scoring: "steps" } })).toBe("name-steps");
    expect(compareRound({ round: "name", nameIt: { ...nameIt, scoring: "ratio" } })).toBe("name-ratio");
    // As the game scores one without its list's scoring: by the estimate's rule.
    expect(compareRound({ round: "name" })).toBe("name-ratio");
  });

  it("keeps each round's comparison apart in the cache", () => {
    expect(compareKey("q", "percent", 30, 20)).not.toBe(compareKey("q", "estimate", 30, 20));
    expect(compareKey("q", "year", 1979, 1969)).toBe("fathom:year:q:1979:1969");
  });

  it("has the limits and the rounds the database has (supabase/migrations, fathom_guesses)", () => {
    const sql = readFileSync(new URL("../../supabase/migrations/20261105130000_fathom_guesses.sql", import.meta.url), "utf8");
    expect(sql).toContain("check (question_id ~ '^[a-z0-9-]{1,64}$')");
    expect(sql).toContain(`check (guess >= 0 and guess < ${MAX_GUESS.toExponential().replace("+", "")})`);
    expect(sql).toContain(`not (p_guess >= 0 and p_guess < ${MAX_GUESS.toExponential().replace("+", "")})`);
    expect(sql).toContain(`p_round not in (${COMPARE_ROUNDS.map((r) => `'${r}'`).join(", ")})`);
  });
});

describe("the guesses outbox", () => {
  function memoryStore() {
    let data: OutboxData<FathomGuess> = { pending: [], sent: [] };
    return { read: () => structuredClone(data), write: (d: OutboxData<FathomGuess>) => void (data = structuredClone(d)), get data() { return data; } };
  }

  it("queues one guess per question: a question drawn again later sends nothing new", () => {
    const store = memoryStore();
    expect(enqueue(store, FATHOM_GUESSES, guess(), T)).toBe(true);
    expect(enqueue(store, FATHOM_GUESSES, guess({ guess: 400, at: T + 60_000 }), T)).toBe(false);
    expect(enqueue(store, FATHOM_GUESSES, guess({ questionId: "moon-distance", guess: 384_000 }), T)).toBe(true);
    expect(store.data.pending.map((g) => [g.questionId, g.guess])).toEqual([
      ["eiffel-tower-height", 300],
      ["moon-distance", 384_000],
    ]);
    expect(enqueue(store, FATHOM_GUESSES, guess({ questionId: "plastic-recycled", guess: -1 }), T)).toBe(false);
    // A name-it round's figure, 0 land borders (an island) included.
    expect(enqueue(store, FATHOM_GUESSES, guess({ questionId: "name-country-6-borders", guess: 0 }), T)).toBe(true);
    expect(store.data.pending.at(-1)).toEqual({ questionId: "name-country-6-borders", guess: 0, at: T });
  });

  it("sends them in order, waits while offline, and remembers what went", async () => {
    const store = memoryStore();
    const sent: FathomGuess[] = [];
    let online = false;
    const box = new Outbox<FathomGuess>(
      store,
      async (g): Promise<SendResult> => {
        if (!online) return "retry";
        sent.push(g);
        return "ok";
      },
      () => T,
      FATHOM_GUESSES,
    );
    box.add(guess());
    box.add(guess({ questionId: "moon-distance", guess: 384_000 }));
    expect(await box.flush()).toBe("retry");
    expect(store.data.pending).toHaveLength(2);
    online = true;
    expect(await box.flush()).toBe("done");
    expect(sent.map((g) => g.questionId)).toEqual(["eiffel-tower-height", "moon-distance"]);
    expect(store.data.pending).toEqual([]);
    // Sent once: the same question again is never queued.
    expect(box.add(guess({ guess: 999 }))).toBe(false);
  });
});

describe("how real players guessed", () => {
  it("reads fathom_compare's answer, and nothing else", () => {
    expect(parseCompare({ n: 37, median: 4, further_off: 0.72 })).toEqual({ n: 37, median: 4, furtherOff: 0.72 });
    expect(parseCompare('{"n": 37, "median": 4, "further_off": "0.7200"}')).toEqual({ n: 37, median: 4, furtherOff: 0.72 });
    expect(parseCompare({ n: 0, median: null, further_off: null })).toEqual({ n: 0, median: null, furtherOff: null });
    // Most players said 0% (or named an island on a land-borders round).
    expect(parseCompare({ n: 25, median: 0, further_off: 0.12 })).toEqual({ n: 25, median: 0, furtherOff: 0.12 });
    for (const bad of [null, "nope", [], { n: -1 }, { n: "x" }, { n: 2, median: -4, further_off: 0.5 }, { n: 2, median: 4, further_off: 2 }]) {
      expect(parseCompare(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe("Today's Fathom: a day's total", () => {
  const day = (offset = 0) => new Date(T + offset * 86_400_000).toISOString().slice(0, 10);
  const play = (over: Partial<FathomPlay> = {}): FathomPlay => ({ date: day(), total: 312, at: T, ...over });

  it("is checked as the database checks it: a whole total 0 to 1000, a date within a day of today", () => {
    expect(invalidFathomPlay(play(), T)).toBeNull();
    for (const total of [0, 500, 1000, 1]) expect(invalidFathomPlay(play({ total }), T)).toBeNull();
    // The player's own day may be a day either side of the server's (time zones).
    expect(invalidFathomPlay(play({ date: day(-1) }), T)).toBeNull();
    expect(invalidFathomPlay(play({ date: day(1) }), T)).toBeNull();
    for (const date of [day(-2), day(2), "2026-02-31", "2026-11-5", "", null as unknown as string]) {
      expect(invalidFathomPlay(play({ date }), T), String(date)).toBe("date");
    }
    for (const total of [-1, 1001, 312.5, NaN, Infinity, "312" as unknown as number, null as unknown as number]) {
      expect(invalidFathomPlay(play({ total }), T), String(total)).toBe("total");
    }
    expect(invalidFathomPlay(play({ at: NaN }), T)).toBe("at");
  });

  it("goes to submit_fathom_play with this browser's id", () => {
    expect(fathomPlayArgs(play({ total: 0 }), "c-1")).toEqual({ p_date: day(), p_total: 0, p_client_id: "c-1" });
    expect(fathomDayKey("2026-11-14")).toBe("fathom-day:2026-11-14");
  });

  it("is queued once per date, and goes stale two days on", async () => {
    let data: OutboxData<FathomPlay> = { pending: [], sent: [] };
    const store = { read: () => structuredClone(data), write: (d: OutboxData<FathomPlay>) => void (data = structuredClone(d)) };
    expect(enqueue(store, FATHOM_PLAYS, play(), T)).toBe(true);
    // The same day played again (another tab, a reload): the first total is the one sent.
    expect(enqueue(store, FATHOM_PLAYS, play({ total: 480 }), T)).toBe(false);
    expect(enqueue(store, FATHOM_PLAYS, play({ date: day(-1), total: 200 }), T)).toBe(true);
    expect(enqueue(store, FATHOM_PLAYS, play({ total: 1001, date: day(1) }), T)).toBe(false);
    expect(data.pending.map((p) => [p.date, p.total])).toEqual([
      [day(), 312],
      [day(-1), 200],
    ]);
    // Offline until two days on: what waited would only be refused, so it is dropped.
    const sent: FathomPlay[] = [];
    const send = async (p: FathomPlay): Promise<SendResult> => {
      sent.push(p);
      return "ok";
    };
    const box = new Outbox<FathomPlay>(store, send, () => T + 2 * 86_400_000, FATHOM_PLAYS);
    expect(await box.flush()).toBe("done");
    expect(sent).toEqual([]);
    expect(data.pending).toEqual([]);
  });

  it("bins totals by 10 into 100 bins, 1000 with 990-999", () => {
    expect([FATHOM_BIN, FATHOM_BINS, FATHOM_MAX_TOTAL]).toEqual([10, 100, 1000]);
    expect([0, 9, 10, 99, 100, 712, 989, 990, 1000, -3, 1900].map(totalBin)).toEqual([0, 0, 1, 9, 10, 71, 98, 99, 99, 0, 99]);
  });

  it("reads fathom_day_stats' answer, and nothing else", () => {
    const counts = Array<number>(100).fill(0);
    counts[31] = 2;
    counts[99] = 1;
    expect(parseFathomDay({ n: 3, counts, avg: 541.67 })).toEqual({ n: 3, counts, avg: 541.67 });
    expect(parseFathomDay(JSON.stringify({ n: 3, counts, avg: "541.67" }))).toEqual({ n: 3, counts, avg: 541.67 });
    expect(parseFathomDay({ n: 0, counts: Array(100).fill(0), avg: null })).toEqual({ n: 0, counts: Array(100).fill(0), avg: null });
    // A short answer is padded to 100 bins.
    expect(parseFathomDay({ n: 1, counts: [0, 1], avg: 12 })).toEqual({ n: 1, counts: [0, 1, ...Array(98).fill(0)], avg: 12 });
    for (const bad of [
      null,
      "nope",
      [],
      { n: -1, counts },
      { n: 3 },
      { n: 3, counts: [...counts, 0] },
      { n: 3, counts: counts.map((c) => c || -0.5) },
      // Every player is in one bin.
      { n: 4, counts, avg: 300 },
      { n: 3, counts, avg: 1200 },
    ]) {
      expect(parseFathomDay(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("has the limits and the bins the database has (supabase/migrations, fathom_plays)", () => {
    const sql = readFileSync(new URL("../../supabase/migrations/20261114120000_fathom_plays.sql", import.meta.url), "utf8");
    expect(sql).toContain(`check (total >= 0 and total <= ${FATHOM_MAX_TOTAL})`);
    expect(sql).toContain(`p_total < 0 or p_total > ${FATHOM_MAX_TOTAL}`);
    expect(sql).toContain("p_date < today - 1 or p_date > today + 1");
    expect(sql).toContain(`least(f.total / ${FATHOM_BIN}, ${FATHOM_BINS - 1})`);
    expect(sql).toContain(`generate_series(0, ${FATHOM_BINS - 1})`);
  });
});
