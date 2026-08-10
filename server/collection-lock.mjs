import { closeSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { resolveDataPaths } from "./runtime-config.mjs";

const DEFAULT_STALE_AFTER_MS = 15 * 60 * 1000;
const HEARTBEAT_MS = 60 * 1000;

function processExists(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function readLock(lockPath) {
  try {
    return JSON.parse(readFileSync(lockPath, "utf8"));
  } catch {
    return null;
  }
}

function isStale(lock, lockPath, now, staleAfterMs) {
  const createdAt = Date.parse(lock?.createdAt || "");
  let lastHeartbeat = createdAt;
  try { lastHeartbeat = Math.max(lastHeartbeat, statSync(lockPath).mtimeMs); } catch { /* missing lock is stale */ }
  if (!Number.isFinite(lastHeartbeat) || now.getTime() - lastHeartbeat > staleAfterMs) return true;
  return lock.hostname === os.hostname() && !processExists(Number(lock.pid));
}

export function collectionLockPath(environment = process.env) {
  return path.join(resolveDataPaths(environment).dataDirectory, "collector.lock");
}

export function tryAcquireCollectionLock({
  lockPath = collectionLockPath(),
  now = new Date(),
  staleAfterMs = DEFAULT_STALE_AFTER_MS,
} = {}) {
  mkdirSync(path.dirname(lockPath), { recursive: true });
  const token = randomUUID();
  const lock = { token, pid: process.pid, hostname: os.hostname(), createdAt: now.toISOString() };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let descriptor;
    try {
      descriptor = openSync(lockPath, "wx", 0o600);
      writeFileSync(descriptor, JSON.stringify(lock), "utf8");
      closeSync(descriptor);
      const heartbeat = setInterval(() => {
        const current = readLock(lockPath);
        if (current?.token !== token) return;
        const heartbeatAt = new Date();
        try { utimesSync(lockPath, heartbeatAt, heartbeatAt); } catch { /* release or volume failure handles cleanup */ }
      }, HEARTBEAT_MS);
      heartbeat.unref();
      return {
        acquired: true,
        release() {
          clearInterval(heartbeat);
          const current = readLock(lockPath);
          if (current?.token === token) {
            try { unlinkSync(lockPath); } catch (error) { if (error?.code !== "ENOENT") throw error; }
          }
        },
      };
    } catch (error) {
      if (descriptor !== undefined) {
        try { closeSync(descriptor); } catch { /* already closed */ }
      }
      if (error?.code !== "EEXIST") throw error;
      const existing = readLock(lockPath);
      if (attempt === 0 && isStale(existing, lockPath, now, staleAfterMs)) {
        try { unlinkSync(lockPath); } catch (unlinkError) { if (unlinkError?.code !== "ENOENT") return { acquired: false }; }
        continue;
      }
      return { acquired: false };
    }
  }
  return { acquired: false };
}
