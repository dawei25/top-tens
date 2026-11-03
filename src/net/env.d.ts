/// <reference types="vite/client" />

// Backend settings, read at build time (see .env.example and docs/BACKEND.md). All optional: without the first two,
// the game runs with no server at all.
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** "google,email" (default), "email", "google", or "none" for stats without accounts. */
  readonly VITE_SIGN_IN?: string;
  /** An address for privacy questions, shown on the privacy page. */
  readonly VITE_PRIVACY_CONTACT?: string;
}
