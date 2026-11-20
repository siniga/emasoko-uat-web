export const WALLET_LOGIN_TIMEOUT_MS = 30000;
const READ_TIMEOUT_MS = 12000;

export function fetchWalletPortal(url: URL, options: { token?: string; body?: object; timeoutMs?: number; idempotencyKey?: string } = {}) {
  return fetch(url, {
    method: options.body ? "POST" : "GET",
    headers: {
      Accept: "application/json",
      ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    redirect: "error", cache: "no-store",
    signal: AbortSignal.timeout(options.timeoutMs ?? READ_TIMEOUT_MS),
  });
}

export function walletLoginFailure(error: unknown): { status: number; message: string } {
  const name = error instanceof Error ? error.name : "";
  const cause = error instanceof Error && typeof error.cause === "object" && error.cause !== null
    ? error.cause as { code?: string } : undefined;
  if (name === "TimeoutError" || name === "AbortError" || ["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT"].includes(cause?.code ?? "")) {
    return { status: 504, message: "Sign-in took too long. Please try again." };
  }
  if (["ECONNREFUSED", "ENOTFOUND", "EHOSTUNREACH"].includes(cause?.code ?? "")) {
    return { status: 502, message: "The sign-in server cannot be reached. Check that the portal is running, then try again." };
  }
  return { status: 502, message: "The sign-in server could not complete the request. Please try again." };
}
