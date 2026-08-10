import { timingSafeEqual } from "node:crypto";

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left), "utf8");
  const rightBuffer = Buffer.from(String(right), "utf8");
  const size = Math.max(leftBuffer.length, rightBuffer.length, 1);
  const paddedLeft = Buffer.alloc(size);
  const paddedRight = Buffer.alloc(size);
  leftBuffer.copy(paddedLeft);
  rightBuffer.copy(paddedRight);
  return timingSafeEqual(paddedLeft, paddedRight) && leftBuffer.length === rightBuffer.length;
}

export function authorizeRefresh(authorizationHeader, expectedSecret) {
  if (!expectedSecret) return { ok: false, status: 503, error: "Refresh authentication is not configured" };
  if (!authorizationHeader) return { ok: false, status: 401, error: "Authentication required" };
  const match = String(authorizationHeader).match(/^Bearer ([^\s]+)$/i);
  if (!match) return { ok: false, status: 401, error: "Malformed authorization header" };
  if (!safeEqual(match[1], expectedSecret)) return { ok: false, status: 403, error: "Invalid credentials" };
  return { ok: true, status: 200 };
}
