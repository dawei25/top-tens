import { describe, expect, it, vi } from "vitest";
// The Vercel function lives in api/ (every file there becomes an endpoint, so its test lives here).
import { handleDelete, supabaseAdmin, type AccountAdmin } from "../../api/delete-account";

/** A user id (Supabase's are UUIDs, and the admin API checks). */
const U = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const req = (method = "POST", auth?: string) =>
  new Request("https://tentacle.example/api/delete-account", { method, headers: auth ? { authorization: auth } : {} });

function admin(users: Record<string, string>): AccountAdmin & { removed: string[] } {
  const removed: string[] = [];
  return {
    removed,
    userFor: async (token) => users[token] ?? null,
    remove: async (id) => void removed.push(id),
  };
}

describe("POST /api/delete-account", () => {
  it("deletes the account the access token belongs to, and only that one", async () => {
    const a = admin({ "token-a": U });
    const res = await handleDelete(req("POST", "Bearer token-a"), a);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true });
    expect(a.removed).toEqual([U]);
  });

  it("needs a token Supabase accepts", async () => {
    const a = admin({ "token-a": U });
    expect((await handleDelete(req("POST"), a)).status).toBe(401);
    expect((await handleDelete(req("POST", "token-a"), a)).status).toBe(401);
    expect((await handleDelete(req("POST", "Bearer forged"), a)).status).toBe(401);
    expect(a.removed).toEqual([]);
  });

  it("only answers POST, and says so when the server isn't set up", async () => {
    expect((await handleDelete(req("GET", "Bearer token-a"), admin({}))).status).toBe(405);
    expect((await handleDelete(req("POST", "Bearer token-a"), null)).status).toBe(503);
    expect(supabaseAdmin({})).toBeNull();
    expect(supabaseAdmin({ VITE_SUPABASE_URL: "https://x.supabase.co" })).toBeNull();
    expect(supabaseAdmin({ VITE_SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "secret" })).not.toBeNull();
  });

  it("works with Supabase's new secret key, under either env name", async () => {
    const sent: { method: string; path: string; apikey: string | null; auth: string | null }[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const h = new Headers(init?.headers);
      sent.push({ method: init?.method ?? "GET", path: url.pathname + url.search, apikey: h.get("apikey"), auth: h.get("authorization") });
      const body = url.pathname === "/auth/v1/user" ? { id: U, aud: "authenticated" } : url.pathname.startsWith("/auth/") ? {} : null;
      return new Response(body ? JSON.stringify(body) : null, { status: body ? 200 : 204, headers: { "content-type": "application/json" } });
    });
    try {
      const env = { VITE_SUPABASE_URL: "https://x.supabase.co", SUPABASE_SECRET_KEY: "sb_secret_abc" };
      const a = supabaseAdmin(env)!;
      expect(a).not.toBeNull();
      expect(await a.userFor("player-jwt")).toBe(U);
      await a.remove(U);
      // The secret key goes as the apikey; the player's token is what identifies them.
      expect(sent[0]).toEqual({ method: "GET", path: "/auth/v1/user", apikey: "sb_secret_abc", auth: "Bearer player-jwt" });
      expect(sent.slice(1).map((s) => [s.method, s.path, s.apikey])).toEqual([
        ["DELETE", `/rest/v1/feedback?user_id=eq.${U}`, "sb_secret_abc"],
        ["DELETE", `/rest/v1/ratings?user_id=eq.${U}`, "sb_secret_abc"],
        ["DELETE", `/rest/v1/plays?user_id=eq.${U}`, "sb_secret_abc"],
        ["DELETE", `/rest/v1/saves?user_id=eq.${U}`, "sb_secret_abc"],
        ["DELETE", `/auth/v1/admin/users/${U}`, "sb_secret_abc"],
      ]);
      // SUPABASE_SERVICE_ROLE_KEY (the name the docs use) wins when both are set.
      expect(supabaseAdmin({ ...env, SUPABASE_SERVICE_ROLE_KEY: "sb_secret_def" })).not.toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("deletes the rest on a project without the ratings or notes table yet, and stops on any other failure", async () => {
    const sent: string[] = [];
    const missing = { status: 404, code: "PGRST205" };
    const refused: Record<string, { status: number; code: string }> = { "/rest/v1/feedback": missing, "/rest/v1/ratings": missing };
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      sent.push(`${init?.method ?? "GET"} ${url.pathname}`);
      const no = refused[url.pathname];
      if (no) return new Response(JSON.stringify({ code: no.code, message: "nope" }), { status: no.status, headers: { "content-type": "application/json" } });
      return new Response(url.pathname.startsWith("/auth/") ? "{}" : null, { status: url.pathname.startsWith("/auth/") ? 200 : 204, headers: { "content-type": "application/json" } });
    });
    try {
      const a = supabaseAdmin({ VITE_SUPABASE_URL: "https://x.supabase.co", SUPABASE_SECRET_KEY: "sb_secret_abc" })!;
      await a.remove(U);
      const all = ["DELETE /rest/v1/feedback", "DELETE /rest/v1/ratings", "DELETE /rest/v1/plays", "DELETE /rest/v1/saves", `DELETE /auth/v1/admin/users/${U}`];
      expect(sent).toEqual(all);
      // Ratings there, notes not yet (the order the migrations came in): the same.
      sent.length = 0;
      delete refused["/rest/v1/ratings"];
      await a.remove(U);
      expect(sent).toEqual(all);
      // Not allowed to (the migration's grant is missing): the sign-in stays, so the player can try again later.
      sent.length = 0;
      refused["/rest/v1/ratings"] = { status: 403, code: "42501" };
      delete refused["/rest/v1/feedback"];
      await expect(a.remove(U)).rejects.toThrow(/ratings/);
      expect(sent).toEqual(["DELETE /rest/v1/feedback", "DELETE /rest/v1/ratings"]);
      sent.length = 0;
      refused["/rest/v1/feedback"] = { status: 403, code: "42501" };
      await expect(a.remove(U)).rejects.toThrow(/feedback/);
      expect(sent).toEqual(["DELETE /rest/v1/feedback"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("reports failures without details", async () => {
    const broken: AccountAdmin = {
      userFor: vi.fn(async () => U),
      remove: vi.fn(async () => {
        throw new Error("db down: secret detail");
      }),
    };
    const res = await handleDelete(req("POST", "Bearer t"), broken);
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret");
    const unreachable: AccountAdmin = {
      userFor: async () => {
        throw new Error("network");
      },
      remove: vi.fn(),
    };
    expect((await handleDelete(req("POST", "Bearer t"), unreachable)).status).toBe(502);
    expect(unreachable.remove).not.toHaveBeenCalled();
  });
});
