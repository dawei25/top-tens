import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
    svc.reportList(game, "2026-11-01");
    svc.reportList(game, "2026-11-01");
    await vi.waitFor(() => expect(fake.calls.rpc.filter(([fn]) => fn === "submit_play")).toHaveLength(1));
    const [, args] = fake.calls.rpc.find(([fn]) => fn === "submit_play")!;
    expect(args).toEqual({
      p_list_id: "mountains",
      p_mode: "list",
      p_score: 3,
      p_found: 3,
      p_client_id: store.get("top-tens:client-id"),
      p_started_at: new Date(game.startedAt!).toISOString(),
      p_daily_date: "2026-11-01",
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
});
