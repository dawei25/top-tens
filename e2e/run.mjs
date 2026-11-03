// npm run e2e: build, serve dist on 5101, run every e2e/*.e2e.cjs with node's test runner (headless, both viewports).
// Parallel agents: E2E_PORT=5104 npm run e2e serves on another port (default 5101).
// npm run e2e -- states visual: only the specs whose file name contains one of the words.
// UPDATE_BASELINES=1 npm run e2e: rewrite the visual baselines (e2e/baselines) instead of comparing with them.
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, preview } from "vite";
import { BACKEND_ENV } from "./backend-env.cjs";

const PORT = Number(process.env.E2E_PORT) || 5101;
const dir = fileURLToPath(new URL(".", import.meta.url));
const started = Date.now();
const only = process.argv.slice(2);

const files = readdirSync(dir)
  .filter((f) => f.endsWith(".e2e.cjs") && (!only.length || only.some((w) => f.includes(w))))
  .map((f) => dir + f);
if (!files.length) {
  console.error(`e2e: no spec matches ${only.join(", ")}`);
  process.exit(1);
}
// The suite runs without a backend, whatever a local .env.local says (it would send test games to a real project).
// Set env wins over .env files.
const BACKEND_KEYS = [
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_ANON_KEY",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "VITE_SIGN_IN",
  "VITE_PRIVACY_CONTACT",
];
const noBackend = () => {
  for (const key of BACKEND_KEYS) process.env[key] = "";
};
noBackend();

await build({ logLevel: "warn" });
// backend.e2e.cjs plays a copy built with fake Supabase keys against a mocked Supabase. Built here, before the specs
// start in parallel, so the build doesn't slow the others down.
let backendDist;
if (files.some((f) => f.endsWith("backend.e2e.cjs"))) {
  backendDist = mkdtempSync(join(tmpdir(), "tentacle-backend-e2e-"));
  Object.assign(process.env, BACKEND_ENV);
  await build({ logLevel: "warn", build: { outDir: backendDist, emptyOutDir: true } });
  noBackend();
}
const server = await preview({ preview: { port: PORT, strictPort: true }, logLevel: "warn" });
const code = await new Promise((resolve) => {
  const run = spawn(process.execPath, ["--test", "--test-reporter=spec", ...files], {
    stdio: "inherit",
    env: { ...process.env, E2E_URL: `http://localhost:${PORT}/`, ...(backendDist && { E2E_BACKEND_DIST: backendDist }) },
  });
  run.on("exit", (c) => resolve(c ?? 1));
});

await new Promise((r) => server.httpServer.close(r));
if (backendDist) rmSync(backendDist, { recursive: true, force: true });
console.log(`\ne2e: ${code === 0 ? "passed" : "FAILED"} in ${((Date.now() - started) / 1000).toFixed(1)} s (build included)`);
process.exit(code);
