import { spawn } from "node:child_process";
import path from "node:path";
import { validateWebRuntimeConfig } from "../server/runtime-config.mjs";

const root = process.cwd();
const environment = { ...process.env, NODE_ENV: "production" };
validateWebRuntimeConfig(environment);
const port = String(process.env.PRIXRADAR_WEB_PORT || process.env.PORT || 3220);
const host = String(process.env.PRIXRADAR_HOST || "0.0.0.0");
const child = spawn(
  process.execPath,
  [path.join(root, "node_modules", "vinext", "dist", "cli.js"), "start", "--port", port, "--hostname", host],
  { cwd: root, env: { ...environment, PORT: port }, stdio: "inherit" },
);

child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
process.once("SIGINT", () => child.kill("SIGTERM"));
process.once("SIGTERM", () => child.kill("SIGTERM"));
