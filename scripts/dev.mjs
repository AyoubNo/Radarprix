import { spawn } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const children = [
  spawn(process.execPath, [path.join(root, "server", "api-server.mjs")], {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  }),
  spawn(
    process.execPath,
    [path.join(root, "node_modules", "vinext", "dist", "cli.js"), "dev", "--port", "3220"],
    {
      cwd: root,
      env: { ...process.env, WRANGLER_LOG_PATH: ".wrangler/wrangler.log" },
      stdio: "inherit",
    },
  ),
];

let closing = false;
function stop(code = 0) {
  if (closing) return;
  closing = true;
  for (const child of children) if (!child.killed) child.kill();
  setTimeout(() => process.exit(code), 300).unref();
}

for (const child of children) {
  child.on("exit", (code, signal) => {
    if (!closing) stop(code ?? (signal ? 1 : 0));
  });
}
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
