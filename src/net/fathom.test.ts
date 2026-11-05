import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compareArgs, FATHOM_GUESSES, guessArgs, invalidGuess, MAX_GUESS, parseCompare, type FathomGuess } from "./fathom";
import { enqueue, Outbox, type OutboxData, type SendResult } from "./outbox";

const T = Date.UTC(2026, 10, 5, 12);
const guess = (over: Partial<FathomGuess> = {}): FathomGuess => ({ questionId: "eiffel-tower-height", guess: 300, at: T, ...over });

describe("a Fathom guess", () => {
  it("is checked as the database checks it", () => {
    expect(invalidGuess(guess())).toBeNull();
    expect(invalidGuess(guess({ guess: 0.0025 }))).toBeNull();
    expect(invalidGuess(guess({ guess: 2.5e12 }))).toBeNull();
    expect(invalidGuess(guess({ questionId: "Bad Id" }))).toBe("question id");
    expect(invalidGuess(guess({ questionId: "x".repeat(65) }))).toBe("question id");
    for (const bad of [0, -5, NaN, Infinity, MAX_GUESS, "300" as unknown as number]) expect(invalidGuess(guess({ guess: bad })), String(bad)).toBe("guess");
    expect(invalidGuess(guess({ at: NaN }))).toBe("at");
  });

  it("goes to submit_fathom_guess with this browser's id", () => {
    expect(guessArgs(guess({ guess: 1.5e9 }), "c-1")).toEqual({ p_question_id: "eiffel-tower-height", p_guess: 1.5e9, p_client_id: "c-1" });
  });

  it("asks fathom_compare with the answer shown and this browser's id (left out of the crowd)", () => {
    expect(compareArgs("eiffel-tower-height", 300, 330, "c-1")).toEqual({ p_question_id: "eiffel-tower-height", p_guess: 300, p_answer: 330, p_client_id: "c-1" });
  });

  it("has the limits the database has (supabase/migrations, fathom_guesses)", () => {
    const sql = readFileSync(new URL("../../supabase/migrations/20261105130000_fathom_guesses.sql", import.meta.url), "utf8");
    expect(sql).toContain("check (question_id ~ '^[a-z0-9-]{1,64}$')");
    expect(sql).toContain(`guess > 0 and guess < ${MAX_GUESS.toExponential().replace("+", "")}`);
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
    expect(enqueue(store, FATHOM_GUESSES, guess({ guess: -1 }), T)).toBe(false);
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
    for (const bad of [null, "nope", [], { n: -1 }, { n: "x" }, { n: 2, median: -4, further_off: 0.5 }, { n: 2, median: 4, further_off: 2 }]) {
      expect(parseCompare(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});
