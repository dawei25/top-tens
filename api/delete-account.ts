import { createClient } from "@supabase/supabase-js";

/**
 * POST /api/delete-account, a Vercel function. Deletes the signed-in player's account: their save, the games linked
 * to it, then the sign-in itself. Deleting a sign-in needs Supabase's service role key, which must never reach the
 * browser, so it happens here. The caller proves who they are with their session's access token, which Supabase
 * checks; nobody can delete anyone but themselves.
 *
 * Env: SUPABASE_SERVICE_ROLE_KEY (secret) and SUPABASE_URL (or the public VITE_SUPABASE_URL).
 */

export interface AccountAdmin {
  /** The user an access token belongs to, or null if Supabase doesn't accept it (expired, forged, signed out). */
  userFor(token: string): Promise<string | null>;
  /** Delete the user's data and then the user. */
  remove(userId: string): Promise<void>;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export async function handleDelete(request: Request, admin: AccountAdmin | null): Promise<Response> {
  if (request.method !== "POST") return json(405, { error: "use POST" });
  if (!admin) return json(503, { error: "account deletion isn't set up on this server" });
  const token = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
  if (!token) return json(401, { error: "sign in first" });
  let userId: string | null;
  try {
    userId = await admin.userFor(token);
  } catch {
    return json(502, { error: "couldn't check the sign-in" });
  }
  if (!userId) return json(401, { error: "sign in again" });
  try {
    await admin.remove(userId);
  } catch {
    return json(500, { error: "couldn't delete the account" });
  }
  return json(200, { deleted: true });
}

export function supabaseAdmin(env: Record<string, string | undefined> = process.env): AccountAdmin | null {
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  return {
    async userFor(token) {
      const { data, error } = await sb.auth.getUser(token);
      return error || !data.user ? null : data.user.id;
    },
    async remove(userId) {
      // The foreign keys would cascade too; deleting first keeps it explicit and survives a missing cascade.
      for (const table of ["plays", "saves"]) {
        const { error } = await sb.from(table).delete().eq("user_id", userId);
        if (error) throw new Error(`${table}: ${error.message}`);
      }
      const { error } = await sb.auth.admin.deleteUser(userId);
      if (error) throw new Error(`auth: ${error.message}`);
    },
  };
}

export function POST(request: Request): Promise<Response> {
  return handleDelete(request, supabaseAdmin());
}
