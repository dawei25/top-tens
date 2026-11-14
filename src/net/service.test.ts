import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localDate } from "../game/daily";
import type { GameState } from "../game/state";

/**
 * The service against a fake Supabase client: what it sends, what it keeps when offline, how it reads and writes the
 * account's save. (The real client is exercised by the e2e spec, against mocked endpoints.)
 */

type Result = { data: unknown; error: { message: string; code?: string } | null; status: number };

function fakeSupabase() {
  const calls: { rpc: [string, unknown, unknown][]; saves: { op: string; args: unknown[] }[] } = { rpc: [], saves: [] };
  const answers = {
    rpc: (fn: string, args: Record<string, unknown>): Result => {
      void args;
      return fn === "list_stats"
        ? { data: { n: 120, counts: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 75], avg: 8.1 }, error: null, status: 200 }
        : { data: true, error: null, status: 200 };
    },
    row: null as { data: unknown; version: number } | null,
  };
  /** A chainable query that records its steps and resolves like PostgREST would. */
  const query = (op: string, payload?: unknown) => {
    const filters: [string, unknown][] = [];
    const q = {
      eq(col: string, v: unknown) {
        filters.push([col, v]);
        return q;
      },
      select: () => q,
      maybeSingle: () => {
        calls.saves.push({ op, args: filters });
        return Promise.resolve({ data: answers.row, error: null, status: 200 });
      },
      single: () => {
        calls.saves.push({ op, args: [payload] });
        if (answers.row) return Promise.resolve({ data: null, error: { message: "duplicate", code: "23505" }, status: 409 });
        answers.row = { data: (payload as { data: unknown }).data, version: 1 };
        return Promise.resolve({ data: { version: 1 }, error: null, status: 201 });
      },
      then(resolve: (r: Result) => void) {
        // update(...).eq(...).eq(...).select() awaited directly.
        calls.saves.push({ op, args: [payload, ...filters] });
        const base = filters.find(([c]) => c === "version")?.[1];
        if (!answers.row || answers.row.version !== base) return resolve({ data: [], error: null, status: 200 });
        const p = payload as { data: unknown; version: number };
        answers.row = { data: p.data, version: p.version };
        return resolve({ data: [{ version: p.version }], error: null, status: 200 });
      },
    };
    return q;
  };
  const client = {
    rpc: vi.fn((fn: string, args: Record<string, unknown>, opts?: unknown) => {
      calls.rpc.push([fn, args, opts]);
      return Promise.resolve(answers.rpc(fn, args));
    }),
    from: () => ({
      select: () => query("select"),
      insert: (payload: unknown) => query("insert", payload),
      update: (payload: unknown) => query("update", payload),
    }),
    auth: {
      onAuthStateChange: vi.fn(),
      getSession: vi.fn(async () => ({ data: { session: null } })),
      signOut: vi.fn(async () => ({ error: null })),
    },
  };
  return { client, calls, answers };
}

let fake: ReturnType<typeof fakeSupabase>;
let store: Map<string, string>;

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key");
  fake = fakeSupabase();
  vi.doMock("@supabase/supabase-js", () => ({ createClient: () => fake.client }));
  store = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  vi.stubGlobal("navigator", { onLine: true });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.doUnmock("@supabase/supabase-js");
  vi.useRealTimers();
});

const finished = (over: Partial<GameState> = {}): GameState => ({
  puzzleId: "mountains",
  found: [1, 2, 3],
  lives: 0,
  log: [],
  status: "lost",
  startedAt: Date.now() - 120_000,
  finishedAt: Date.now() - 1000,
  ...over,
});

describe("sendResult", () => {
  it("retries what might work later and drops what never will", async () => {
    const { sendResult } = await import("./service");
    expect(sendResult(200, null)).toBe("ok");
    expect(sendResult(0, { message: "Failed to fetch" })).toBe("retry");
    expect(sendResult(503, {})).toBe("retry");
    expect(sendResult(429, {})).toBe("retry");
    expect(sendResult(401, {})).toBe("retry");
    expect(sendResult(400, {})).toBe("drop");
    expect(sendResult(404, {})).toBe("drop");
  });
});

describe("plays", () => {
  it("sends a finished game once, with this browser's id", async () => {
    const svc = await import("./service");
    const game = finished();
    // Today's daily (the server only takes a daily date within a day of now).
    const today = localDate();
    svc.reportList(game, today);
    svc.reportList(game, today);
    await vi.waitFor(() => expect(fake.calls.rpc.filter(([fn]) => fn === "submit_play")).toHaveLength(1));
    const [, args] = fake.calls.rpc.find(([fn]) => fn === "submit_play")!;
    expect(args).toEqual({
      p_list_id: "mountains",
      p_mode: "list",
      p_score: 3,
      p_found: 3,
      p_client_id: store.get("top-tens:client-id"),
      p_started_at: new Date(game.startedAt!).toISOString(),
      p_daily_date: today,
    });
    // The results' numbers were fetched as the game ended.
    expect(fake.calls.rpc.some(([fn]) => fn === "list_stats")).toBe(true);
    await vi.waitFor(() => expect(JSON.parse(store.get("top-tens:outbox")!).pending).toEqual([]));
  });

  it("keeps a game played offline and sends it when the connection is back", async () => {
    const svc = await import("./service");
    const real = fake.answers.rpc;
    fake.answers.rpc = (fn, args) => (fn === "submit_play" ? { data: null, error: { message: "TypeError: Failed to fetch" }, status: 0 } : real(fn, args));
    svc.reportList(finished());
    await vi.waitFor(() => expect(fake.calls.rpc.filter(([fn]) => fn === "submit_play")).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(JSON.parse(store.get("top-tens:outbox")!).pending).toHaveLength(1);

    fake.answers.rpc = real;
    await svc.flushPlays();
    expect(fake.calls.rpc.filter(([fn]) => fn === "submit_play")).toHaveLength(2);
    expect(JSON.parse(store.get("top-tens:outbox")!).pending).toEqual([]);
  });

  it("skips games still going or without a start time", async () => {
    const svc = await import("./service");
    svc.reportList(finished({ status: "playing" }));
    svc.reportList(finished({ startedAt: undefined }));
    await new Promise((r) => setTimeout(r, 10));
    expect(fake.calls.rpc).toEqual([]);
  });
});

describe("ratings", () => {
  const sentRatings = () => fake.calls.rpc.filter(([fn]) => fn === "rate_list").map(([, args]) => args);
  const rating = (over: Partial<import("./ratings").Rating> = {}): import("./ratings").Rating => ({
    listId: "mountains",
    mode: "list",
    rating: 1,
    reason: null,
    at: Date.now(),
    ...over,
  });

  it("sends a rating to rate_list with this browser's id", async () => {
    const svc = await import("./service");
    svc.rateList(rating({ rating: -1, reason: "wrong-data" }));
    await vi.waitFor(() => expect(sentRatings()).toHaveLength(1));
    expect(sentRatings()[0]).toEqual({
      p_list_id: "mountains",
      p_mode: "list",
      p_rating: -1,
      p_reason: "wrong-data",
      p_client_id: store.get("top-tens:client-id"),
    });
    await vi.waitFor(() => expect(JSON.parse(store.get("top-tens:rating-outbox")!).pending).toEqual([]));
  });

  it("keeps the latest rating while offline and sends it when the connection is back", async () => {
    const svc = await import("./service");
    const real = fake.answers.rpc;
    fake.answers.rpc = (fn, args) => (fn === "rate_list" ? { data: null, error: { message: "TypeError: Failed to fetch" }, status: 0 } : real(fn, args));
    const at = Date.now();
    svc.rateList(rating({ at }));
    await vi.waitFor(() => expect(sentRatings()).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 0));
    svc.rateList(rating({ rating: -1, reason: "boring", at: at + 1 }));
    await new Promise((r) => setTimeout(r, 0));
    expect(JSON.parse(store.get("top-tens:rating-outbox")!).pending.map((r: { rating: number }) => r.rating)).toEqual([-1]);

    fake.answers.rpc = real;
    await svc.flushRatings();
    expect(sentRatings().at(-1)).toMatchObject({ p_rating: -1, p_reason: "boring" });
    expect(JSON.parse(store.get("top-tens:rating-outbox")!).pending).toEqual([]);
  });

  it("doesn't send a rating another device has replaced since (that device sends its own)", async () => {
    const at = Date.now() - 60_000;
    store.set("top-tens:v1", JSON.stringify({ games: {}, daily: {}, seenHelp: true, ratings: { "list:mountains": { rating: -1, at: at + 1000 } } }));
    store.set("top-tens:rating-outbox", JSON.stringify({ pending: [rating({ at })], sent: [] }));
    const svc = await import("./service");
    await svc.flushRatings();
    expect(sentRatings()).toEqual([]);
    expect(JSON.parse(store.get("top-tens:rating-outbox")!).pending).toEqual([]);
  });
});

describe("Fathom guesses", () => {
  const sentGuesses = () => fake.calls.rpc.filter(([fn]) => fn === "submit_fathom_guess").map(([, args]) => args);
  const queue = (items: object[]) => store.set("top-tens:fathom-outbox", JSON.stringify({ pending: items, sent: [] }));

  it("sends each guess the facade queued to submit_fathom_guess, with this browser's id, and keeps it while offline", async () => {
    queue([{ questionId: "eiffel-tower-height", guess: 300, at: Date.now() }]);
    const svc = await import("./service");
    const real = fake.answers.rpc;
    fake.answers.rpc = (fn, args) => (fn === "submit_fathom_guess" ? { data: null, error: { message: "TypeError: Failed to fetch" }, status: 0 } : real(fn, args));
    await svc.flushFathom();
    expect(JSON.parse(store.get("top-tens:fathom-outbox")!).pending).toHaveLength(1);
    fake.answers.rpc = real;
    await svc.flushFathom();
    expect(sentGuesses().at(-1)).toEqual({ p_question_id: "eiffel-tower-height", p_guess: 300, p_client_id: store.get("top-tens:client-id") });
    expect(JSON.parse(store.get("top-tens:fathom-outbox")!)).toEqual({ pending: [], sent: ["eiffel-tower-height"] });
  });

  it("sends a name-it round's figure, 0 (an island's land borders) included", async () => {
    queue([
      { questionId: "name-country-6-borders", guess: 0, at: Date.now() },
      { questionId: "name-country-50m-people", guess: 52_890_000, at: Date.now() },
    ]);
    const svc = await import("./service");
    await svc.flushFathom();
    expect(sentGuesses()).toEqual([
      { p_question_id: "name-country-6-borders", p_guess: 0, p_client_id: store.get("top-tens:client-id") },
      { p_question_id: "name-country-50m-people", p_guess: 52_890_000, p_client_id: store.get("top-tens:client-id") },
    ]);
  });

  it("drops a guess the server refuses for good, or that it doesn't know yet (the migration not run: 404)", async () => {
    queue([{ questionId: "moon-distance", guess: 384_000, at: Date.now() }]);
    fake.answers.rpc = () => ({ data: null, error: { message: "not found" }, status: 404 });
    const svc = await import("./service");
    await svc.flushFathom();
    expect(JSON.parse(store.get("top-tens:fathom-outbox")!).pending).toEqual([]);
  });

  it("asks fathom_compare (a read, GET) with the round, the answer shown and this browser's id, once, and reads its answer", async () => {
    fake.answers.rpc = (fn) => (fn === "fathom_compare" ? { data: { n: 37, median: 4, further_off: 0.72 }, error: null, status: 200 } : { data: true, error: null, status: 200 });
    const svc = await import("./service");
    const a = await svc.fathomCompare("blood-volume", 5, 5.5, "estimate");
    expect(await svc.fathomCompare("blood-volume", 5, 5.5, "estimate")).toBe(a);
    expect(a).toEqual({ n: 37, median: 4, furtherOff: 0.72 });
    const id = store.get("top-tens:client-id");
    expect(fake.calls.rpc).toEqual([["fathom_compare", { p_question_id: "blood-volume", p_round: "estimate", p_guess: 5, p_answer: 5.5, p_client_id: id }, { get: true }]]);
    fake.answers.rpc = () => ({ data: null, error: { message: "boom" }, status: 404 });
    expect(await svc.fathomCompare("blood-volume", 6, 5.5, "estimate")).toBeNull();
  });

  it("asks a percent, a year and a name-it round on their own scale, each its own question to the server", async () => {
    fake.answers.rpc = (fn, args) =>
      fn === "fathom_compare" ? { data: { n: 25, median: args.p_round === "year" ? 1959 : 0, further_off: 0.2 }, error: null, status: 200 } : { data: true, error: null, status: 200 };
    const svc = await import("./service");
    expect(await svc.fathomCompare("plastic-recycled", 0, 9, "percent")).toEqual({ n: 25, median: 0, furtherOff: 0.2 });
    expect(await svc.fathomCompare("moon-landing", 1979, 1969, "year")).toEqual({ n: 25, median: 1959, furtherOff: 0.2 });
    await svc.fathomCompare("name-country-6-borders", 0, 6, "name-steps");
    // The same question and numbers on another scale is another answer.
    await svc.fathomCompare("plastic-recycled", 0, 9, "estimate");
    expect(fake.calls.rpc.map(([, args]) => [(args as { p_question_id: string }).p_question_id, (args as { p_round: string }).p_round])).toEqual([
      ["plastic-recycled", "percent"],
      ["moon-landing", "year"],
      ["name-country-6-borders", "name-steps"],
      ["plastic-recycled", "estimate"],
    ]);
  });
});

describe("Today's Fathom totals", () => {
  const sentTotals = () => fake.calls.rpc.filter(([fn]) => fn === "submit_fathom_play").map(([, args]) => args);
  const queue = (items: object[]) => store.set("top-tens:fathom-play-outbox", JSON.stringify({ pending: items, sent: [] }));
  const today = new Date().toISOString().slice(0, 10);

  it("sends each total the facade queued to submit_fathom_play, with this browser's id, and keeps it while offline", async () => {
    queue([{ date: today, total: 312, at: Date.now() }]);
    const svc = await import("./service");
    const real = fake.answers.rpc;
    fake.answers.rpc = (fn, args) => (fn === "submit_fathom_play" ? { data: null, error: { message: "TypeError: Failed to fetch" }, status: 0 } : real(fn, args));
    await svc.flushFathomPlays();
    expect(JSON.parse(store.get("top-tens:fathom-play-outbox")!).pending).toHaveLength(1);
    fake.answers.rpc = real;
    await svc.flushFathomPlays();
    expect(sentTotals()).toEqual([
      { p_date: today, p_total: 312, p_client_id: store.get("top-tens:client-id") },
      { p_date: today, p_total: 312, p_client_id: store.get("top-tens:client-id") },
    ]);
    expect(store.get("top-tens:client-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(store.get("top-tens:fathom-play-outbox")!)).toEqual({ pending: [], sent: [today] });
  });

  it("sends what waited when the backend code starts", async () => {
    queue([{ date: today, total: 0, at: Date.now() }]);
    const svc = await import("./service");
    await svc.start();
    await vi.waitFor(() => expect(sentTotals()).toEqual([{ p_date: today, p_total: 0, p_client_id: store.get("top-tens:client-id") }]));
  });

  it("drops a total the server refuses for good, or doesn't know yet (the migration not run: 404)", async () => {
    queue([{ date: today, total: 312, at: Date.now() }]);
    fake.answers.rpc = () => ({ data: null, error: { message: "not found" }, status: 404 });
    const svc = await import("./service");
    await svc.flushFathomPlays();
    expect(JSON.parse(store.get("top-tens:fathom-play-outbox")!).pending).toEqual([]);
  });

  it("reads a day's totals from fathom_day_stats (a read, GET), once, and nothing it can't read", async () => {
    const counts = Array<number>(50).fill(0);
    counts[31] = 40;
    fake.answers.rpc = (fn) => (fn === "fathom_day_stats" ? { data: { n: 40, counts, avg: 315.5 }, error: null, status: 200 } : { data: true, error: null, status: 200 });
    const svc = await import("./service");
    const a = await svc.fathomDay("2026-11-14");
    expect(await svc.fathomDay("2026-11-14")).toBe(a);
    expect(a).toEqual({ n: 40, counts, avg: 315.5 });
    expect(fake.calls.rpc).toEqual([["fathom_day_stats", { p_date: "2026-11-14" }, { get: true }]]);
    const { recall } = await import("./store");
    expect(recall("fathom-day:2026-11-14")?.value).toEqual(a);
    // The server can't say (the migration not run), or says something else: null, never a throw.
    fake.answers.rpc = () => ({ data: null, error: { message: "not found" }, status: 404 });
    expect(await svc.fathomDay("2026-11-13")).toBeNull();
    fake.answers.rpc = () => ({ data: { n: 3, counts: [1] }, error: null, status: 200 });
    expect(await svc.fathomDay("2026-11-12")).toBeNull();
  });
});

describe("missed guesses", () => {
  const queue = (items: object[]) => store.set("top-tens:miss-outbox", JSON.stringify({ pending: items, sent: [] }));
  const at = Date.now();
  /** fetch as the browser has it: answers `status` (or fails, offline), and records each request. */
  function fakeFetch(status: () => number | "offline" = () => 200) {
    const requests: { url: string; method?: string; headers: Record<string, string>; body: unknown; credentials?: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        requests.push({
          url: String(url),
          method: init.method,
          headers: Object.fromEntries(new Headers(init.headers).entries()),
          body: JSON.parse(String(init.body)),
          credentials: init.credentials,
        });
        const s = status();
        if (s === "offline") throw new TypeError("Failed to fetch");
        return new Response(JSON.stringify(s < 300), { status: s, headers: { "content-type": "application/json" } });
      }),
    );
    return requests;
  }

  it("sends each miss to submit_miss with the public key alone and its own random id, never the player's", async () => {
    const requests = fakeFetch();
    // Signed in, with a session supabase-js would send.
    fake.client.auth.getSession.mockImplementation(async () => ({ data: { session: { access_token: "the-players-token", user: { id: "u-1" } } } }) as never);
    const svc = await import("./service");
    svc.reportList(finished());
    await vi.waitFor(() => expect(store.get("top-tens:client-id")).toBeTruthy());
    queue([
      { listId: "mountains", mode: "list", kind: "unknown", text: "pizza", at },
      { listId: "airports", mode: "blitz", kind: "junk", text: "xqzzvkw", at: at + 1 },
    ]);
    await svc.flushMisses();
    const id = store.get("top-tens:miss-id");
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(id).not.toBe(store.get("top-tens:client-id"));
    expect(requests.map((r) => r.body)).toEqual([
      { p_list_id: "mountains", p_mode: "list", p_kind: "unknown", p_text: "pizza", p_client_id: id },
      { p_list_id: "airports", p_mode: "blitz", p_kind: "junk", p_text: "xqzzvkw", p_client_id: id },
    ]);
    for (const r of requests) {
      expect(r.url).toBe("https://example.supabase.co/rest/v1/rpc/submit_miss");
      expect(r.method).toBe("POST");
      expect(r.headers).toEqual({ apikey: "anon-key", authorization: "Bearer anon-key", "content-type": "application/json" });
      expect(r.credentials).toBe("omit");
    }
    // Never through the signed-in client.
    expect(fake.calls.rpc.filter(([fn]) => fn === "submit_miss")).toEqual([]);
    expect(JSON.parse(store.get("top-tens:miss-outbox")!)).toEqual({ pending: [], sent: ["list:mountains:pizza", "blitz:airports:xqzzvkw"] });
  });

  it("keeps a miss while offline (or the server is busy) and sends it when the connection is back", async () => {
    let answer: number | "offline" = "offline";
    const requests = fakeFetch(() => answer);
    queue([{ listId: "mountains", mode: "list", kind: "unknown", text: "pizza", at }]);
    const svc = await import("./service");
    await svc.flushMisses();
    expect(JSON.parse(store.get("top-tens:miss-outbox")!).pending).toHaveLength(1);
    answer = 503;
    await svc.flushMisses();
    expect(JSON.parse(store.get("top-tens:miss-outbox")!).pending).toHaveLength(1);
    answer = 200;
    await svc.flushMisses();
    expect(requests).toHaveLength(3);
    expect(JSON.parse(store.get("top-tens:miss-outbox")!)).toEqual({ pending: [], sent: ["list:mountains:pizza"] });
  });

  it("drops a miss the server refuses for good, or doesn't know yet (the migration not run: 404), and anything malformed", async () => {
    const requests = fakeFetch(() => 404);
    queue([
      { listId: "mountains", mode: "list", kind: "unknown", text: "pizza", at },
      // Broken in storage: never sent.
      { listId: "mountains", mode: "list", kind: "near", text: "broad peak", at },
      { listId: "mountains", mode: "list", kind: "unknown", text: "dana@example.com", at },
    ]);
    const svc = await import("./service");
    await svc.flushMisses();
    expect(requests.map((r) => (r.body as { p_text: string }).p_text)).toEqual(["pizza"]);
    expect(JSON.parse(store.get("top-tens:miss-outbox")!).pending).toEqual([]);
  });
});

describe("stats", () => {
  it("asks once per list and mode (with GET, it's a read), then answers from the cache", async () => {
    const svc = await import("./service");
    const a = await svc.listStats("mountains", "list");
    const b = await svc.listStats("mountains", "list");
    expect(a).toEqual({ n: 120, counts: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 75], avg: 8.1 });
    expect(b).toBe(a);
    expect(fake.calls.rpc).toEqual([["list_stats", { p_list_id: "mountains", p_mode: "list" }, { get: true }]]);
    // Remembered for screens that open later.
    const { recall } = await import("./store");
    expect(recall("stats:list:mountains")?.value).toEqual(a);
  });

  it("answers null when the server can't, without throwing", async () => {
    fake.answers.rpc = () => ({ data: null, error: { message: "boom" }, status: 500 });
    const svc = await import("./service");
    expect(await svc.listStats("mountains", "blitz")).toBeNull();
    expect(await svc.listAverages()).toBeNull();
  });
});

describe("email and password", () => {
  const authError = (code: string, status = 400, message = "") => Object.assign(new Error(message), { code, status });
  // A confirmation link (if the project sends one) comes back to this page.
  beforeEach(() => vi.stubGlobal("location", { origin: "https://tentacle.example", pathname: "/" }));

  it("signs up and is signed in at once when the project doesn't ask to confirm the email", async () => {
    const signUp = vi.fn(async () => ({ data: { user: { id: "u" }, session: { access_token: "t" } }, error: null }));
    Object.assign(fake.client.auth, { signUp });
    const svc = await import("./service");
    expect(await svc.signUpWithPassword("dana@example.com", "trustno1")).toEqual({ error: null, confirm: false });
    expect(signUp).toHaveBeenCalledWith({ email: "dana@example.com", password: "trustno1", options: { emailRedirectTo: "https://tentacle.example/" } });
  });

  it("says to check the email when the project does ask to confirm it", async () => {
    Object.assign(fake.client.auth, { signUp: async () => ({ data: { user: { id: "u" }, session: null }, error: null }) });
    const svc = await import("./service");
    expect(await svc.signUpWithPassword("dana@example.com", "trustno1")).toEqual({ error: null, confirm: true });
  });

  it("explains a refusal in plain words", async () => {
    const svc = await import("./service");
    expect(svc.passwordError(authError("invalid_credentials"), false)).toBe("wrong email or password.");
    expect(svc.passwordError(authError("user_already_exists", 422), true)).toBe("that email already has an account. sign in instead.");
    expect(svc.passwordError(authError("weak_password", 422, "Password should be at least 6 characters."), true)).toBe(
      "password should be at least 6 characters.",
    );
    expect(svc.passwordError(authError("email_not_confirmed"), false)).toMatch(/^confirm your email first/);
    expect(svc.passwordError(authError("whatever", 429), false)).toBe("too many tries. wait a minute and try again.");
    expect(svc.passwordError(authError("unexpected_failure", 500), true)).toBe("couldn't create the account. try again.");
    Object.assign(fake.client.auth, { signInWithPassword: async () => ({ data: {}, error: authError("invalid_credentials") }) });
    expect(await svc.signInWithPassword("dana@example.com", "nope")).toBe("wrong email or password.");
  });
});

describe("google sign-in", () => {
  it("hands Supabase the ID token with the raw nonce, and explains a refusal", async () => {
    const signInWithIdToken = vi.fn(async (_: unknown) => ({ data: { user: { id: "u" }, session: { access_token: "t" } }, error: null }));
    Object.assign(fake.client.auth, { signInWithIdToken });
    const svc = await import("./service");
    expect(await svc.signInWithGoogleToken("header.claims.sig", "raw-nonce")).toBeNull();
    expect(signInWithIdToken).toHaveBeenCalledWith({ provider: "google", token: "header.claims.sig", nonce: "raw-nonce" });

    const refused = (status: number) => async () => ({ data: { user: null, session: null }, error: Object.assign(new Error("Nonces mismatch"), { status }) });
    Object.assign(fake.client.auth, { signInWithIdToken: refused(400) });
    expect(await svc.signInWithGoogleToken("t", "n")).toBe("google sign-in didn't work. try again.");
    Object.assign(fake.client.auth, { signInWithIdToken: refused(429) });
    expect(await svc.signInWithGoogleToken("t", "n")).toBe("too many tries. wait a minute and try again.");
    // supabase-js answers a request that never got through with status 0.
    Object.assign(fake.client.auth, { signInWithIdToken: refused(0) });
    expect(await svc.signInWithGoogleToken("t", "n")).toBe("couldn't reach the server. check your connection.");
  });
});

describe("back from Google in this tab (a blocked popup, or one with no way back)", () => {
  function returned(result: unknown, pending: unknown) {
    const session = new Map<string, string>([["top-tens:google-result", JSON.stringify(result)]]);
    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => session.get(k) ?? null,
      setItem: (k: string, v: string) => void session.set(k, v),
      removeItem: (k: string) => void session.delete(k),
    });
    vi.stubGlobal("location", new URL("https://toptentacle.vercel.app/#stats"));
    vi.stubGlobal("history", { state: null, replaceState: vi.fn() });
    store.set("top-tens:google-pending", JSON.stringify(pending));
    return session;
  }

  it("finishes the sign-in on startup with the try's own nonce, and uses both records up", async () => {
    const session = returned({ state: "s1", token: "header.claims.sig" }, { state: "s1", nonce: "raw1", at: Date.now(), back: "#stats" });
    const signInWithIdToken = vi.fn(async (_: unknown) => ({ data: {}, error: null }));
    const user = { id: "u1", email: "dana@example.com", user_metadata: { full_name: "Dana Scully" }, app_metadata: { provider: "google" } };
    const getSession = vi.fn().mockResolvedValueOnce({ data: { session: null } }).mockResolvedValue({ data: { session: { user } } });
    Object.assign(fake.client.auth, { signInWithIdToken, getSession });
    const svc = await import("./service");
    const { getAccount } = await import("./store");
    await svc.start();
    expect(signInWithIdToken).toHaveBeenCalledExactlyOnceWith({ provider: "google", token: "header.claims.sig", nonce: "raw1" });
    expect(getAccount()).toMatchObject({ status: "in", user: { id: "u1", google: true }, notice: undefined });
    expect(session.size).toBe(0);
    expect(store.has("top-tens:google-pending")).toBe(false);
  });

  it("refuses an answer to a try this browser didn't make, and says so in the sheet", async () => {
    returned({ state: "forged", token: "header.claims.sig" }, { state: "s1", nonce: "raw1", at: Date.now(), back: "" });
    const signInWithIdToken = vi.fn();
    Object.assign(fake.client.auth, { signInWithIdToken });
    const svc = await import("./service");
    const { getAccount } = await import("./store");
    const { NO_MATCH } = await import("./google");
    await svc.start();
    expect(signInWithIdToken).not.toHaveBeenCalled();
    expect(getAccount()).toMatchObject({ status: "out", notice: NO_MATCH });
  });
});

describe("sync through the service", () => {
  it("creates the account's save, then updates it by version", async () => {
    const svc = await import("./service");
    const { setAccount, getAccount } = await import("./store");
    store.set("top-tens:v1", JSON.stringify({ games: {}, daily: { "2026-11-01": "mountains" }, seenHelp: true }));
    setAccount({ status: "in", user: { id: "user-1", name: "Dana" } });

    await svc.syncNow();
    expect(getAccount().sync).toBe("synced");
    expect(fake.calls.saves.map((c) => c.op)).toEqual(["select", "insert"]);
    expect(fake.calls.saves[0].args).toEqual([["user_id", "user-1"]]);
    expect(fake.answers.row?.version).toBe(1);

    // Another device adds a streak day; this one merges it in and writes version 2.
    fake.answers.row = { data: { games: {}, daily: { "2026-10-31": "islands" }, seenHelp: false }, version: 1 };
    await svc.syncNow();
    expect(fake.calls.saves.map((c) => c.op)).toEqual(["select", "insert", "select", "update"]);
    expect(fake.answers.row?.version).toBe(2);
    expect(JSON.parse(store.get("top-tens:v1")!).daily).toEqual({ "2026-10-31": "islands", "2026-11-01": "mountains" });
  });

  it("does nothing when signed out", async () => {
    const svc = await import("./service");
    await svc.syncNow();
    expect(fake.calls.saves).toEqual([]);
  });

  it("never merges one account's games into another's on a shared device", async () => {
    const svc = await import("./service");
    const { setAccount } = await import("./store");
    const run = (id: string) => ({ id, startedAt: 1, finishedAt: 2, status: "lost", found: [], lives: 0, hints: 0 });
    // Ann synced here, then signed out offline, so her latest game stayed on the device.
    store.set("top-tens:sync-owner", "ann");
    store.set("top-tens:v1", JSON.stringify({ games: {}, daily: {}, seenHelp: true, listRuns: [run("ann-game")] }));

    setAccount({ status: "in", user: { id: "bob", name: "Bob" } });
    await svc.syncNow();
    expect(JSON.parse(store.get("top-tens:v1")!).listRuns ?? []).toEqual([]);
    // Bob's account never saw Ann's game.
    expect((fake.answers.row!.data as { listRuns?: unknown[] }).listRuns ?? []).toEqual([]);
    expect(JSON.parse(store.get("top-tens:v1:ann")!).listRuns[0].id).toBe("ann-game");
    expect(store.get("top-tens:sync-owner")).toBe("bob");

    // Ann signs in again: her game comes back (and goes to her account).
    fake.answers.row = null;
    setAccount({ status: "in", user: { id: "ann", name: "Ann" } });
    await svc.syncNow();
    expect(JSON.parse(store.get("top-tens:v1")!).listRuns.map((r: { id: string }) => r.id)).toEqual(["ann-game"]);
    expect(store.has("top-tens:v1:ann")).toBe(false);
  });

  it("signs out to a fresh device once the account has the save, and keeps it when it couldn't sync", async () => {
    const svc = await import("./service");
    const { setAccount, getAccount } = await import("./store");
    const saved = { games: {}, daily: { "2026-11-01": "mountains" }, seenHelp: true };
    store.set("top-tens:v1", JSON.stringify(saved));
    setAccount({ status: "in", user: { id: "u", name: "Dana" } });
    await svc.signOut();
    expect(getAccount().status).toBe("out");
    expect(JSON.parse(store.get("top-tens:v1")!)).toEqual({ games: {}, daily: {}, seenHelp: true });
    expect(store.has("top-tens:sync-owner")).toBe(false);

    // Offline: the save can't reach the account, so it stays here.
    vi.resetModules();
    const offline = await import("./service");
    const s2 = await import("./store");
    fake.client.from = () => {
      throw new TypeError("Failed to fetch");
    };
    store.set("top-tens:v1", JSON.stringify(saved));
    s2.setAccount({ status: "in", user: { id: "u", name: "Dana" } });
    await offline.signOut();
    expect(s2.getAccount().status).toBe("out");
    expect(JSON.parse(store.get("top-tens:v1")!)).toEqual(saved);
  });
});
