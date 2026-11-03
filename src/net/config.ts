/**
 * The backend (Supabase) settings, from the build's env. Without a URL and an anon key the game has no server: it
 * sends nothing, loads no backend code, and behaves exactly as it always has.
 */
export interface Backend {
  url: string;
  anonKey: string;
  /** Sign-in methods offered; empty means stats only (no accounts). */
  signIn: SignInMethod[];
}

export type SignInMethod = "google" | "email";

export function readBackend(url?: string, anonKey?: string, signIn?: string): Backend | null {
  const u = url?.trim() ?? "";
  const k = anonKey?.trim() ?? "";
  if (!u || !k || !/^https?:\/\/[^\s/]+/.test(u)) return null;
  const wanted = (signIn?.trim() || "google,email").toLowerCase().split(/[\s,]+/);
  const methods = (["google", "email"] as const).filter((m) => wanted.includes(m));
  return { url: u.replace(/\/+$/, ""), anonKey: k, signIn: methods };
}

/**
 * Both checks start with the raw env, which the build replaces with literals: in a build without a backend they fold
 * to `false`, and the bundler and minifier drop the code behind them.
 */
const configured = !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);

export const BACKEND: Backend | null = configured
  ? readBackend(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY, import.meta.env.VITE_SIGN_IN)
  : null;

/** Whether this build talks to a backend at all (anonymous score stats). */
export const backendOn: boolean = configured && BACKEND !== null;

/** Whether players can sign in (accounts and sync). */
export const accountsOn: boolean = configured && !!BACKEND && BACKEND.signIn.length > 0;

/** Where privacy questions go, if the owner set one. */
export const PRIVACY_CONTACT = import.meta.env.VITE_PRIVACY_CONTACT?.trim() ?? "";
