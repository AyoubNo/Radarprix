export class ApiTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`API request timed out after ${timeoutMs}ms`);
    this.name = "ApiTimeoutError";
  }
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit & { timeoutMs?: number; next?: { revalidate?: number } } = {},
) {
  const timeoutMs = Math.max(100, Number(init.timeoutMs) || 5_000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new ApiTimeoutError(timeoutMs)), timeoutMs);
  const externalSignal = init.signal;
  const abortFromExternal = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) abortFromExternal();
  else externalSignal?.addEventListener("abort", abortFromExternal, { once: true });
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.reason instanceof ApiTimeoutError) throw controller.signal.reason;
    throw error;
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", abortFromExternal);
  }
}
