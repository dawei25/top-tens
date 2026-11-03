// The fake backend env that backend.e2e.cjs builds its copy with (run.mjs builds it up front with the same values).
// Every sign-in method is on, so the spec can check each one.
exports.BACKEND_ENV = {
  VITE_SUPABASE_URL: "https://e2e-test.supabase.co",
  VITE_SUPABASE_ANON_KEY: "sb_publishable_e2e-test-key",
  VITE_SIGN_IN: "google,email,password",
  VITE_PRIVACY_CONTACT: "privacy@example.com",
};
