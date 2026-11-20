export const WALLET_BROWSER_TIMEOUT_MS = 20000;

// Covers both response headers and JSON decoding, even if the frontend server stalls.
export async function walletBrowserRequest(url: string, options: RequestInit = {}, timeoutMs = WALLET_BROWSER_TIMEOUT_MS) {
  const controller = new AbortController();
  const parentSignal = options.signal;
  const abortFromParent = () => controller.abort(parentSignal?.reason);
  if (parentSignal?.aborted) abortFromParent();
  else parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException("Wallet request timed out.", "TimeoutError")), timeoutMs);
  try {
    const response = await fetch(url, { ...options, cache: "no-store", signal: controller.signal });
    const data = await response.json();
    return { response, data };
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener("abort", abortFromParent);
  }
}