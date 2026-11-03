import { describe, expect, it, vi } from "vitest";
// The Vercel function lives in api/ (every file there becomes an endpoint, so its test lives here).
import { handleDelete, supabaseAdmin, type AccountAdmin } from "../../api/delete-account";

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
    const a = admin({ "token-a": "user-a" });
    const res = await handleDelete(req("POST", "Bearer token-a"), a);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true });
    expect(a.removed).toEqual(["user-a"]);
  });

  it("needs a token Supabase accepts", async () => {
    const a = admin({ "token-a": "user-a" });
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

  it("reports failures without details", async () => {
    const broken: AccountAdmin = {
      userFor: vi.fn(async () => "user-a"),
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
