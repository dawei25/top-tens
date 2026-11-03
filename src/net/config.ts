/**
 * The backend (Supabase) settings, from the build's env. Without a URL and a public key the game has no server: it
 * sends nothing, loads no backend code, and behaves exactly as it always has.
 *
 * The public key is Supabase's publishable key (`sb_publishable_...`) or, on older projects, the legacy anon key; both
 * go in VITE_SUPABASE_ANON_KEY (VITE_SUPABASE_PUBLISHABLE_KEY works too, and wins if both are set).
 */
export interface Backend {
  url: string;
  /** The publishable (or legacy anon) key: public, built into the page. */
  anonKey: string;
  /** Sign-in methods offered (VITE_SIGN_IN); empty means stats only (no accounts). */
  signIn: SignInMethod[];
}

/** google: Google. email: a link (and code) by email. password: an email and password, no email sent. */
export type SignInMethod = "google" | "email" | "password";
const METHODS: readonly SignInMethod[] = ["google", "email", "password"];
const DEFAULT_SIGN_IN = "google,email";

export function readBackend(url?: string, anonKey?: string, signIn?: string): Backend | null {
  const u = url?.trim() ?? "";
  const k = anonKey?.trim() ?? "";
  if (!u || !k || !/^https?:\/\/[^\s/]+/.test(u)) return null;
  // Unknown names ("none", typos, methods a newer build adds) are skipped.
  const wanted = (signIn?.trim() || DEFAULT_SIGN_IN).toLowerCase().split(/[\s,]+/);
  const methods = METHODS.filter((m) => wanted.includes(m));
  return { url: u.replace(/\/+$/, ""), anonKey: k, signIn: methods };
}

/**
 * Both checks start with the raw env, which the build replaces with literals: in a build without a backend they fold
 * to `false`, and the bundler and minifier drop the code behind them.
 */
const publicKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;
const configured = !!(import.meta.env.VITE_SUPABASE_URL && publicKey);

export const BACKEND: Backend | null = configured
  ? readBackend(import.meta.env.VITE_SUPABASE_URL, publicKey, import.meta.env.VITE_SIGN_IN)
  : null;

/** Whether this build talks to a backend at all (anonymous score stats). */
export const backendOn: boolean = configured && BACKEND !== null;

/** Whether players can sign in (accounts and sync). */
export const accountsOn: boolean = configured && !!BACKEND && BACKEND.signIn.length > 0;

/** Where privacy questions go, if the owner set one. */
export const PRIVACY_CONTACT = import.meta.env.VITE_PRIVACY_CONTACT?.trim() ?? "";
