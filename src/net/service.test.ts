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

describe("google's button", () => {
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
