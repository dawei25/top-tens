/// <reference types="vite/client" />

// Backend settings, read at build time (see .env.example and docs/BACKEND.md). All optional: without a URL and a
// public key, the game runs with no server at all.
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  /** The publishable key (sb_publishable_...), or a legacy anon key. */
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** The same key under its new name; wins over VITE_SUPABASE_ANON_KEY when both are set. */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  /** Comma list of "google", "email", "password" (default "google,email"); "none" for stats without accounts. */
  readonly VITE_SIGN_IN?: string;
  /** Google's OAuth web client ID (…apps.googleusercontent.com): Google sign-in with Google's own button. */
  readonly VITE_GOOGLE_CLIENT_ID?: string;
  /** An address for privacy questions, shown on the privacy page and next to "forgot your password?". */
  readonly VITE_PRIVACY_CONTACT?: string;
}
