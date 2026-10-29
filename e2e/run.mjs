// npm run e2e: build, serve dist on 5101, run every e2e/*.e2e.cjs with node's test runner (headless, both viewports).
// Parallel agents: E2E_PORT=5104 npm run e2e serves on another port (default 5101).
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build, preview } from "vite";

const PORT = Number(process.env.E2E_PORT) || 5101;
const dir = fileURLToPath(new URL(".", import.meta.url));
const started = Date.now();

await build({ logLevel: "warn" });
const server = await preview({ preview: { port: PORT, strictPort: true }, logLevel: "warn" });

const files = readdirSync(dir)
  .filter((f) => f.endsWith(".e2e.cjs"))
  .map((f) => dir + f);
const code = await new Promise((resolve) => {
  const run = spawn(process.execPath, ["--test", "--test-reporter=spec", ...files], {
    stdio: "inherit",
    env: { ...process.env, E2E_URL: `http://localhost:${PORT}/` },
  });
  run.on("exit", (c) => resolve(c ?? 1));
});

await new Promise((r) => server.httpServer.close(r));
console.log(`\ne2e: ${code === 0 ? "passed" : "FAILED"} in ${((Date.now() - started) / 1000).toFixed(1)} s (build included)`);
process.exit(code);
