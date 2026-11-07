// The fake backend env that the backend specs build their copies with (run.mjs builds them up front with the same
// values). Every sign-in method is on, so the specs can check each one.
exports.BACKEND_ENV = {
  VITE_SUPABASE_URL: "https://e2e-test.supabase.co",
  VITE_SUPABASE_ANON_KEY: "sb_publishable_e2e-test-key",
  VITE_SIGN_IN: "google,email,password",
  VITE_PRIVACY_CONTACT: "privacy@example.com",
};

// The launch build (backend-google.e2e.cjs): a Google client ID, for Google sign-in from this site to Google and back,
// and no VITE_SIGN_IN, so the default methods: Google alone (owner, Nov 7: "google only for now"). The client ID is
// pasted with a trailing newline, the way Vercel kept the owner's: the game trims it.
exports.GOOGLE_CLIENT_ID = "1234567890-e2etest.apps.googleusercontent.com";
exports.GOOGLE_ENV = { ...exports.BACKEND_ENV, VITE_SIGN_IN: "", VITE_GOOGLE_CLIENT_ID: `${exports.GOOGLE_CLIENT_ID}\n` };
