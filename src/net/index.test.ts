import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BlitzState } from "../game/blitz";
import type { GameState } from "../game/state";
import { readBackend, readGoogleClientId } from "./config";

const game: GameState = { puzzleId: "mountains", found: [1, 2], lives: 0, log: [], status: "lost", startedAt: Date.now() - 60_000, finishedAt: Date.now() };
const round: BlitzState = { puzzleId: "airports", startedAt: Date.now() - 95_000, endedAt: Date.now() - 5000, hits: [] };

/** Just enough of a browser for the facade: storage, events, the address bar. */
function fakeBrowser() {
  const store = new Map<string, string>();
  const listeners: string[] = [];
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  vi.stubGlobal("addEventListener", (type: string) => listeners.push(type));
  vi.stubGlobal("document", { addEventListener: (type: string) => listeners.push(`document:${type}`), visibilityState: "visible" });
  vi.stubGlobal("location", { search: "", hash: "", origin: "http://localhost", pathname: "/" });
  return { store, listeners };
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.doUnmock("@supabase/supabase-js");
  vi.doUnmock("./service");
});

describe("readBackend", () => {
  it("needs both a URL and an anon key", () => {
    expect(readBackend()).toBeNull();
    expect(readBackend("", "")).toBeNull();
    expect(readBackend("https://x.supabase.co", "")).toBeNull();
    expect(readBackend("", "key")).toBeNull();
    expect(readBackend("not a url", "key")).toBeNull();
    expect(readBackend(" https://x.supabase.co/ ", " key ")).toEqual({ url: "https://x.supabase.co", anonKey: "key", signIn: ["google", "email"] });
  });

  it("offers the sign-in methods VITE_SIGN_IN names (google and email by default, none to switch accounts off)", () => {
    expect(readBackend("https://x.supabase.co", "k", "email")?.signIn).toEqual(["email"]);
    expect(readBackend("https://x.supabase.co", "k", "Google , email")?.signIn).toEqual(["google", "email"]);
    expect(readBackend("https://x.supabase.co", "k", "none")?.signIn).toEqual([]);
    expect(readBackend("https://x.supabase.co", "k", "google,password")?.signIn).toEqual(["google", "password"]);
    expect(readBackend("https://x.supabase.co", "k", "password, email ,google")?.signIn).toEqual(["google", "email", "password"]);
  });

  it("ignores sign-in methods it doesn't know", () => {
    expect(readBackend("https://x.supabase.co", "k", "google,facebook,passwrd")?.signIn).toEqual(["google"]);
    expect(readBackend("https://x.supabase.co", "k", "sms")?.signIn).toEqual([]);
  });
});

describe("env values pasted with a trailing newline (Vercel keeps it)", () => {
  it("are trimmed: URL, key, sign-in methods, Google client ID", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co\n");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "\n");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "sb_publishable_key\n");
    vi.stubEnv("VITE_SIGN_IN", "google,password\n");
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "1234-abc.apps.googleusercontent.com\n");
    const config = await import("./config");
    expect(config.BACKEND).toEqual({ url: "https://example.supabase.co", anonKey: "sb_publishable_key", signIn: ["google", "password"] });
    expect(config.GOOGLE_CLIENT_ID).toBe("1234-abc.apps.googleusercontent.com");
  });
});

describe("the Google client ID", () => {
  it("is a web client ID, trimmed; anything else keeps the redirect sign-in", () => {
    expect(readGoogleClientId("1234-abc_D.apps.googleusercontent.com")).toBe("1234-abc_D.apps.googleusercontent.com");
    expect(readGoogleClientId("  1234-abc.apps.googleusercontent.com\r\n")).toBe("1234-abc.apps.googleusercontent.com");
    expect(readGoogleClientId()).toBe("");
    expect(readGoogleClientId("\n")).toBe("");
    expect(readGoogleClientId("GOCSPX-secret")).toBe("");
    expect(readGoogleClientId("1234-abc.apps.googleusercontent.com 5678-def.apps.googleusercontent.com")).toBe("");
  });

  it("is used only when the build offers Google", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "k");
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "1234-abc.apps.googleusercontent.com");
    vi.stubEnv("VITE_SIGN_IN", "password");
    expect((await import("./config")).GOOGLE_CLIENT_ID).toBe("");
    vi.resetModules();
    vi.stubEnv("VITE_SIGN_IN", "google");
    expect((await import("./config")).GOOGLE_CLIENT_ID).toBe("1234-abc.apps.googleusercontent.com");
    // No backend, no Google.
    vi.resetModules();
    vi.stubEnv("VITE_SUPABASE_URL", "");
    expect((await import("./config")).GOOGLE_CLIENT_ID).toBe("");
  });
});

describe("the public key", () => {
  it("is read as VITE_SUPABASE_ANON_KEY, or VITE_SUPABASE_PUBLISHABLE_KEY (which wins)", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "sb_publishable_old-name");
    expect((await import("./config")).BACKEND?.anonKey).toBe("sb_publishable_old-name");
    vi.resetModules();
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_new-name");
    expect((await import("./config")).BACKEND?.anonKey).toBe("sb_publishable_new-name");
    vi.resetModules();
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "");
    expect((await import("./config")).backendOn).toBe(true);
  });
});

describe("without a backend (no env)", () => {
  it("is off, imports no backend code, sends nothing and stores nothing", async () => {
    const imported = vi.fn();
    vi.doMock("@supabase/supabase-js", () => {
      imported("supabase");
      return {};
    });
    vi.doMock("./service", () => {
      imported("service");
      return {};
    });
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const { store, listeners } = fakeBrowser();

    const net = await import("./index");
    expect(net.backendOn).toBe(false);
    expect(net.accountsOn).toBe(false);
    net.startNet();
    net.reportList(game);
    net.reportBlitz(round, "2026-11-01");
    net.noteReset();
    expect(net.loadService()).toBeNull();
    await new Promise((r) => setTimeout(r, 10));

    expect(imported).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
    expect(listeners).toEqual([]);
    const { getAccount } = await import("./store");
    expect(getAccount().status).toBe("off");
  });
});

describe("with a backend", () => {
  function configure(signIn?: string) {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key");
    if (signIn !== undefined) vi.stubEnv("VITE_SIGN_IN", signIn);
  }

  it("hands finished games to the backend code, loaded on first use", async () => {
    configure();
    const svc = { start: vi.fn(), reportList: vi.fn(), reportBlitz: vi.fn() };
    vi.doMock("./service", () => svc);
    fakeBrowser();

    const net = await import("./index");
    expect(net.backendOn).toBe(true);
    expect(net.accountsOn).toBe(true);
    net.startNet();
    // Nothing waiting and nobody signed in: the backend code isn't loaded at startup.
    expect(svc.start).not.toHaveBeenCalled();
    net.reportList(game, "2026-11-01");
    net.reportBlitz(round);
    await vi.waitFor(() => expect(svc.reportBlitz).toHaveBeenCalled());
    expect(svc.reportList).toHaveBeenCalledWith(game, "2026-11-01");
    expect(svc.reportBlitz).toHaveBeenCalledWith(round, undefined);
  });

  it("loads the backend code at startup when plays are waiting or a session is stored", async () => {
    configure();
    const svc = { start: vi.fn() };
    vi.doMock("./service", () => svc);
    const { store } = fakeBrowser();
    store.set("top-tens:auth", "{}");
    const net = await import("./index");
    net.startNet();
    const { getAccount } = await import("./store");
    expect(getAccount().status).toBe("loading");
    await vi.waitFor(() => expect(svc.start).toHaveBeenCalled());
  });

  it("shows a stored session's player at once, before the backend code arrives", async () => {
    configure();
    vi.doMock("./service", () => ({ start: vi.fn() }));
    const { store } = fakeBrowser();
    store.set(
      "top-tens:auth",
      JSON.stringify({ access_token: "t", user: { id: "u-1", email: "dana@example.com", user_metadata: { full_name: "Dana Scully" }, app_metadata: { provider: "google" } } }),
    );
    const net = await import("./index");
    net.startNet();
    const { getAccount } = await import("./store");
    expect(getAccount()).toMatchObject({ status: "in", user: { id: "u-1", name: "Dana Scully", email: "dana@example.com", google: true } });
  });

  it("is signed out (not loading) at startup when there's no session, and off when accounts are switched off", async () => {
    configure();
    fakeBrowser();
    let net = await import("./index");
    net.startNet();
    expect((await import("./store")).getAccount().status).toBe("out");

    vi.resetModules();
    configure("none");
    fakeBrowser();
    net = await import("./index");
    expect(net.backendOn).toBe(true);
    expect(net.accountsOn).toBe(false);
    net.startNet();
    expect((await import("./store")).getAccount().status).toBe("off");
  });

  it("stamps a reset on the save only when signed in", async () => {
    configure();
    vi.doMock("./service", () => ({ syncSoon: vi.fn() }));
    const { store } = fakeBrowser();
    store.set("top-tens:v1", JSON.stringify({ games: {}, daily: {}, seenHelp: true }));
    const net = await import("./index");
    const { setAccount } = await import("./store");
    net.noteReset();
    expect(JSON.parse(store.get("top-tens:v1")!).resetAt).toBeUndefined();
    setAccount({ status: "in", user: { id: "u", name: "Dana" } });
    net.noteReset();
    expect(JSON.parse(store.get("top-tens:v1")!).resetAt).toBeGreaterThan(0);
  });
});
