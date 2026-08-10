export function isLoopbackAddress(address) {
  const value = String(address || "").toLowerCase();
  return value === "127.0.0.1" || value === "::1" || value === "::ffff:127.0.0.1";
}

function isDevelopmentOrigin(origin) {
  try {
    const hostname = new URL(origin).hostname.toLowerCase();
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

export function corsHeaders(requestOrigin, { siteOrigin, production }) {
  const origin = String(requestOrigin || "");
  const allowed = origin && (origin === siteOrigin || (!production && isDevelopmentOrigin(origin)));
  return {
    vary: "Origin",
    ...(allowed ? { "access-control-allow-origin": origin } : {}),
  };
}

export function isCorsOriginAllowed(requestOrigin, config) {
  if (!requestOrigin) return true;
  return Boolean(corsHeaders(requestOrigin, config)["access-control-allow-origin"]);
}
