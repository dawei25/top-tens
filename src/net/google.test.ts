import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CredentialResponse, GoogleId } from "./google";

/**
 * Google's button (Google Identity Services) against a fake `google.accounts.id`: the script is added once and only on
 * demand, the nonce Google gets is the SHA-256 of the one Supabase gets, and every token goes out with its own nonce.
 */

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
/** An ID token shaped like Google's (unsigned: only Supabase checks the signature). */
const idToken = (claims: Record<string, unknown>) => `${b64url({ alg: "RS256", typ: "JWT" })}.${b64url(claims)}.sig`;

type Script = { src: string; async: boolean; onload?: () => void; onerror?: () => void; remove: () => void };

/** A page with a <head> that records the scripts added to it, and a window Google's script can fill in. */
function fakePage() {
  const scripts: Script[] = [];
  const win: { google?: { accounts?: { id?: GoogleId } } } = {};
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", {
    createElement: (tag: string) => {
      expect(tag).toBe("script");
      const s: Script = { src: "", async: false, remove: () => scripts.splice(scripts.indexOf(s), 1) };
      return s;
    },
    head: { append: (s: Script) => scripts.push(s) },
  });
  return { scripts, win };
}

/** A fake google.accounts.id: records initialize and renderButton. */
function fakeGis() {
  const inits: Parameters<GoogleId["initialize"]>[0][] = [];
  const renders: { parent: unknown; options: Parameters<GoogleId["renderButton"]>[1] }[] = [];
  const id: GoogleId = {
    initialize: (c) => void inits.push(c),
    renderButton: (parent, options) => void renders.push({ parent, options }),
  };
  /** Google's popup finished: the latest config's callback gets a token carrying that config's nonce. */
  const signIn = (nonce = inits.at(-1)!.nonce) => {
    const r: CredentialResponse = { credential: idToken({ sub: "1", aud: "client", nonce, name: "Zoë" }), select_by: "btn" };
    inits.at(-1)!.callback(r);
    return r.credential;
  };
  return { id, inits, renders, signIn };
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("the nonce", () => {
  it("is random, and Google gets its SHA-256 in hex (Supabase's check)", async () => {
    const { makeNonce } = await import("./google");
    const a = await makeNonce();
    const b = await makeNonce();
    expect(a.raw).toMatch(/^[0-9a-f]{64}$/);
    expect(a.hashed).toBe(sha256(a.raw));
    expect(b.raw).not.toBe(a.raw);
  });

  it("is read back from an ID token (base64url, any name in it)", async () => {
    const { tokenNonce } = await import("./google");
    expect(tokenNonce(idToken({ nonce: "abc123", name: "Zoë Ñúñez" }))).toBe("abc123");
    expect(tokenNonce(idToken({ sub: "1" }))).toBeNull();
    expect(tokenNonce("not a token")).toBeNull();
  });
});

describe("Google's script", () => {
  it("is added once, on demand, and a failed load can be tried again", async () => {
    const { scripts, win } = fakePage();
    const { loadGis, GIS_SRC } = await import("./google");
    expect(scripts).toHaveLength(0);

    const first = loadGis();
    expect(loadGis()).toBe(first);
    expect(scripts).toHaveLength(1);
    expect(scripts[0]).toMatchObject({ src: GIS_SRC, async: true });
    scripts[0].onerror!();
    await expect(first).rejects.toThrow();
    expect(scripts).toHaveLength(0);

    const again = loadGis();
    expect(scripts).toHaveLength(1);
    const { id } = fakeGis();
    win.google = { accounts: { id } };
    scripts[0].onload!();
    await expect(again).resolves.toBe(id);
    // Already there: no second script.
    await expect(loadGis()).resolves.toBe(id);
    expect(scripts).toHaveLength(1);
  });

  it("gives up after a while (blocked, or a very slow network)", async () => {
    vi.useFakeTimers();
    const { scripts } = fakePage();
    const { loadGis } = await import("./google");
    const loading = loadGis(5000);
    const failed = expect(loading).rejects.toThrow();
    vi.advanceTimersByTime(5001);
    await failed;
    expect(scripts).toHaveLength(0);
  });

  it("that loads without google.accounts.id counts as failed", async () => {
    const { scripts } = fakePage();
    const { loadGis } = await import("./google");
    const loading = loadGis();
    scripts[0].onload!();
    await expect(loading).rejects.toThrow();
  });
});

describe("Google's button", () => {
  async function setup(width = 354) {
    const { win } = fakePage();
    const gis = fakeGis();
    win.google = { accounts: { id: gis.id } };
    const el = { clientWidth: width, replaceChildren: vi.fn() };
    const credential = vi.fn();
    const press = vi.fn();
    const { googleButton } = await import("./google");
    const button = await googleButton(el as unknown as HTMLElement, "1234-abc.apps.googleusercontent.com", { credential, press });
    return { ...gis, el, credential, press, button };
  }

  it("asks Google with the hashed nonce, in a popup, and hands Supabase the token with the raw nonce", async () => {
    const { inits, renders, signIn, credential } = await setup();
    expect(inits).toHaveLength(1);
    expect(inits[0]).toMatchObject({ client_id: "1234-abc.apps.googleusercontent.com", ux_mode: "popup", auto_select: false, use_fedcm_for_button: false });
    expect(inits[0].nonce).toMatch(/^[0-9a-f]{64}$/);
    expect(renders[0].options).toMatchObject({ type: "standard", text: "continue_with", size: "large", width: 354 });

    const token = signIn();
    expect(credential).toHaveBeenCalledTimes(1);
    const [sent, raw] = credential.mock.calls[0];
    expect(sent).toBe(token);
    expect(sha256(raw)).toBe(inits[0].nonce);
  });

  it("asks with a new nonce after a try, and a late token still goes with its own nonce", async () => {
    const { inits, renders, signIn, credential, button } = await setup();
    const firstHash = inits[0].nonce!;
    await button.renew();
    expect(inits).toHaveLength(2);
    expect(inits[1].nonce).not.toBe(firstHash);
    expect(renders).toHaveLength(2);
    // A popup opened before the renewal comes back with the first nonce in its token.
    signIn(firstHash);
    expect(sha256(credential.mock.calls[0][1])).toBe(firstHash);
    signIn();
    expect(sha256(credential.mock.calls[1][1])).toBe(inits[1].nonce);
  });

  it("passes on a press, and is drawn 200 to 400 px wide, again only when that changes", async () => {
    const { renders, press, el, button } = await setup(600);
    expect(renders[0].options.width).toBe(400);
    renders[0].options.click_listener!();
    expect(press).toHaveBeenCalled();
    el.clientWidth = 560;
    button.redraw();
    expect(renders).toHaveLength(1);
    el.clientWidth = 320;
    button.redraw();
    expect(renders.at(-1)!.options.width).toBe(320);
    el.clientWidth = 150;
    button.redraw();
    expect(renders.at(-1)!.options.width).toBe(200);
  });
});
