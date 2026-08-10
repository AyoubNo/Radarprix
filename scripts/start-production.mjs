import { spawn } from "node:child_process";
import path from "node:path";
import { getApiRuntimeConfig, validateWebRuntimeConfig } from "../server/runtime-config.mjs";

const root = process.cwd();
const environment = { ...process.env, NODE_ENV: "production" };
const apiConfig = getApiRuntimeConfig(environment);
validateWebRuntimeConfig(environment);
const webPort = String(process.env.PRIXRADAR_WEB_PORT || 3220);
const children = [
  spawn(process.execPath, ["--no-warnings", path.join(root, "server", "api-server.mjs")], {
    cwd: root,
    env: { ...environment, PRIXRADAR_API_PORT: String(apiConfig.port) },
    stdio: "inherit",
  }),
  spawn(process.execPath, [path.join(root, "node_modules", "vinext", "dist", "cli.js"), "start", "--port", webPort], {
    cwd: root,
    env: { ...environment, PORT: webPort },
    stdio: "inherit",
  }),
];

let closing = false;
function stop(code = 0) {
  if (closing) return;
  closing = true;
  for (const child of children) if (!child.killed) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 5_000).unref();
}
for (const child of children) {
  child.on("exit", (code, signal) => {
    if (!closing) stop(code ?? (signal ? 1 : 0));
  });
}
process.once("SIGINT", () => stop(0));
process.once("SIGTERM", () => stop(0));
