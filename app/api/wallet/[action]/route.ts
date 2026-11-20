import { NextRequest, NextResponse } from "next/server";
import { readWithdrawal, readWithdrawalQuote, readWithdrawals, readBank, readStatement, readCollection, readCollections, wholeShillings, readSimulatedCollection, readWalletContext, readWalletSummary } from "@/app/wallet/wallet-data";
import { fetchWalletPortal, walletLoginFailure, WALLET_LOGIN_TIMEOUT_MS } from "../wallet-connection";

const COOKIE = "emakato_wallet_token";
const HEADERS = { "Cache-Control": "no-store, private", Vary: "Cookie" };

function reply(body: object, status = 200) {
  return NextResponse.json(body, { status, headers: HEADERS });
}

function clearSession(response: NextResponse) {
  response.cookies.set(COOKIE, "", { httpOnly: true, sameSite: "strict", path: "/api/wallet", maxAge: 0 });
  return response;
}

function portalUrl(path: string) {
  const base = process.env.WALLET_API_URL ?? process.env.PORTAL_API_URL ?? "http://127.0.0.1:8000/api";
  const url = new URL(`${base.replace(/\/$/, "")}/${path}`);
  if (url.username || url.password || url.search || url.hash || (url.protocol !== "https:"
    && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) {
    throw new Error("Configure a secure portal API URL.");
  }
  return url;
}

async function portal(path: string, token?: string, body?: object, timeoutMs?: number) {
  return fetchWalletPortal(portalUrl(path), { token, body, timeoutMs });
}

function portalError(status: number) {
  if (status === 401) return clearSession(reply({ message: "Please sign in again to view your wallet." }, 401));
  if (status === 403) return reply({ message: "Your account does not have access to this business wallet. Contact your administrator." }, 403);
  if (status === 429) return reply({ message: "Too many requests. Please wait a moment and try again." }, 429);
  return reply({ message: "Wallet information is temporarily unavailable. Please try again." }, 502);
}

export async function GET(request: NextRequest, context: { params: Promise<{ action: string }> }) {
  const { action } = await context.params;
  if (!["context", "summary", "pending-banks", "collections", "statement", "bank-account", "withdrawals"].includes(action)) return reply({ message: "Not found." }, 404);
  const token = request.cookies.get(COOKIE)?.value;
  if (!token) return reply({ message: "Sign in to view your wallet." }, 401);
  const partner = request.nextUrl.searchParams.get("partner_id");
  if (action !== "context" && (!partner || !/^[1-9]\d{0,14}$/.test(partner))) {
    return reply({ message: "Choose an authorised business." }, 400);
  }
  try {
    const url = `v1/wallet/${action}`;
    const target = portalUrl(url);
    if (action !== "context") target.searchParams.set("partner_id", partner!);
    if (action === "withdrawals" && request.nextUrl.searchParams.has("page")) target.searchParams.set("page", request.nextUrl.searchParams.get("page")!);
    if (action === "statement") {
      for (const key of ["page", "anchor"]) {
        const value = request.nextUrl.searchParams.get(key);
        if (value) target.searchParams.set(key, value);
      }
    }
    if (action === "collections") {
      for (const key of ["page", "status", "channel", "collection_id"]) {
        const value = request.nextUrl.searchParams.get(key);
        if (value) target.searchParams.set(key, value);
      }
    }
    const upstream = await fetch(target, {
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(12000),
    });
    if (!upstream.ok) {
      if (action === "collections" && upstream.status === 404) return reply({ message: "Payment not found for this business." }, 404);
      if (action === "collections" && upstream.status === 422) return reply({ message: "Choose valid payment filters." }, 422);
      return portalError(upstream.status);
    }
    const data: unknown = await upstream.json();
    if (action === "withdrawals") return reply(readWithdrawals(data));
    if (action === "bank-account") return reply({ bank: readBank((data as { bank?: unknown }).bank) });
    if (action === "statement") return reply(readStatement(data));
    if (action === "collections") {
      if (request.nextUrl.searchParams.get("collection_id")) {
        const payload = data as { success?: boolean; data?: { collection?: unknown } };
        if (payload.success !== true) throw new Error();
        return reply({ collection: readCollection(payload.data?.collection) });
      }
      return reply(readCollections(data));
    }
    if (action === "pending-banks") {
      const items = (data as { items?: unknown }).items;
      if (!Array.isArray(items)) throw new Error();
      return reply({ items: items.map(item => {
        if (typeof item.id !== "string" || typeof item.reference !== "string") throw new Error();
        return { id: item.id, reference: item.reference, amount: wholeShillings(item.amount) };
      }) });
    }
    return reply(action === "context" ? readWalletContext(data) : readWalletSummary(data, Number(partner)));
  } catch {
    return reply({ message: "We cannot load your wallet right now. Please try again." }, 502);
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ action: string }> }) {
  const { action } = await context.params;
  if (!["login", "logout", "simulate-collection", "settle-bank", "simulate-bank-account", "otp-request", "otp-verify", "withdrawal-otp", "withdrawals", "withdrawal-decision", "withdrawal-transfer"].includes(action)) return reply({ message: "Not found." }, 404);
  // NextURL normalises loopback addresses to localhost. Use the browser's Host
  // header to compare exact origins, or an explicit public origin behind a proxy.
  const origin = process.env.WALLET_ORIGIN ?? new URL(`${request.nextUrl.protocol}//${request.headers.get("host") ?? request.nextUrl.host}`).origin;
  if (request.headers.get("origin") !== origin) return reply({ message: "This request must come from the eMakato website." }, 403);
  const frontend = new URL(origin);
  if (frontend.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(frontend.hostname)) {
    return reply({ message: "A secure connection is required to sign in." }, 503);
  }

  if (action === "logout") {
    const token = request.cookies.get(COOKIE)?.value;
    try {
      if (token) await portal("mobile/v1/logout", token, {});
    } catch { /* Always end the browser session even when the portal is unavailable. */ }
    return clearSession(reply({ success: true }));
  }

  if (action === "withdrawal-decision" || action === "withdrawal-transfer") {
    const token = request.cookies.get(COOKIE)?.value;
    if (!token) return reply({ message: "Please sign in again." }, 401);
    let body;
    try {
      const input = await request.json();
      if (!input || !Number.isSafeInteger(input.partner_id) || input.partner_id <= 0) throw new Error();
      body = { partner_id: input.partner_id, withdrawal_id: input.withdrawal_id, action: input.action, reason: input.reason };
    } catch { return reply({ message: "Choose a business and withdrawal action." }, 422); }
    try {
      const upstream = await portal(`v1/wallet/${action}`, token, body, 30000);
      if (!upstream.ok) {
        if (upstream.status === 401) return portalError(401);
        const messages: Record<number, string> = { 403: "An assigned checker with business access must act. You cannot check your own withdrawal.",
          404: "This simulated withdrawal is unavailable.", 409: "This action conflicts with the current status, recorded details, or wallet freeze. Refresh withdrawals.",
          422: "Choose a valid action. Rejection and transfer failure require a reason (up to 200 characters)." };
        return messages[upstream.status] ? reply({ message: messages[upstream.status] }, upstream.status) : portalError(upstream.status);
      }
      const data = await upstream.json();
      return reply({ withdrawal: readWithdrawal(data.withdrawal) });
    } catch { return reply({ message: "The action result is uncertain. Retry the same action safely." }, 502); }
  }

  if (action === "withdrawal-otp" || action === "withdrawals") {
    const token = request.cookies.get(COOKIE)?.value;
    if (!token) return reply({ message: "Please sign in again." }, 401);
    const key = request.headers.get("Idempotency-Key") ?? "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)) return reply({ message: "A valid withdrawal request ID is required." }, 422);
    let body;
    try {
      const input = await request.json();
      if (!input || !Number.isSafeInteger(input.partner_id) || input.partner_id <= 0) throw new Error();
      body = { partner_id: input.partner_id, amount: input.amount,
        ...(action === "withdrawals" ? { challenge_id: input.challenge_id, code: input.code } : {}) };
    } catch { return reply({ message: "Choose a business and enter valid withdrawal details." }, 422); }
    try {
      const upstream = await fetchWalletPortal(portalUrl(`v1/wallet/${action}`), { token, body, idempotencyKey: key, timeoutMs: 30000 });
      if (!upstream.ok) {
        const defaults: Record<number, string> = { 404: "Withdrawal simulation or code request is unavailable.", 409: "The withdrawal details or code are no longer valid. Check Withdrawals before starting again.",
          410: "This code has expired. Request a new one.", 422: "Check your code and whole-shilling amount. Available funds must cover the full amount, which must exceed TZS 2,500.",
          423: "Too many incorrect attempts. Request a new code.", 429: "Wait 30 seconds before requesting another code." };
        if (!defaults[upstream.status]) return portalError(upstream.status);
        const allowed = new Set(["Wallet is frozen.", "A dedicated test bank account is required.", "Insufficient available balance.", "Insufficient available balance for this withdrawal.", "Incorrect code.", "This withdrawal request already exists. Check Withdrawals.", "The code does not match these withdrawal details."]);
        const error = await upstream.json();
        return reply({ message: allowed.has(error.message) ? error.message : defaults[upstream.status] }, upstream.status);
      }
      const data = await upstream.json();
      return reply(action === "withdrawal-otp" ? readWithdrawalQuote(data) : { withdrawal: readWithdrawal(data.withdrawal) }, upstream.status);
    } catch { return reply({ message: "The withdrawal result is uncertain. Retry the same request to avoid reserving twice." }, 502); }
  }

  if (["simulate-bank-account", "otp-request", "otp-verify"].includes(action)) {
    const token = request.cookies.get(COOKIE)?.value;
    if (!token) return reply({ message: "Please sign in again." }, 401);
    let body;
    try {
      const input = await request.json();
      if (!input || !Number.isSafeInteger(input.partner_id) || input.partner_id <= 0) throw new Error();
      body = action === "simulate-bank-account" ? { partner_id: input.partner_id, bank_name: input.bank_name, account_name: input.account_name, account_number: input.account_number }
        : action === "otp-verify" ? { partner_id: input.partner_id, challenge_id: input.challenge_id, code: input.code } : { partner_id: input.partner_id };
    } catch { return reply({ message: "Enter valid details and choose a business." }, 422); }
    try {
      const upstream = await portal(`v1/wallet/${action}`, token, body, 30000);
      if (!upstream.ok) {
        const messages: Record<number, string> = {
          404: "This simulation is unavailable or the code request was not found.",
          409: action === "simulate-bank-account" ? "A dedicated bank account is already set. Replacement requires Operations verification." : action === "otp-request" ? "Set up a dedicated test bank account first." : "This code has already been used or replaced.",
          410: "This code has expired. Request a new one.", 422: "The details or code are invalid. Please check and try again.",
          423: "Too many incorrect attempts. Request a new code.", 429: "Wait 30 seconds before requesting another code.",
        };
        return messages[upstream.status] ? reply({ message: messages[upstream.status] }, upstream.status) : portalError(upstream.status);
      }
      const data = await upstream.json();
      if (action === "simulate-bank-account") return reply({ bank: readBank(data.bank) }, upstream.status);
      if (action === "otp-verify") {
        if (data.verified !== true || data.purpose !== "SETUP_PRACTICE") throw new Error();
        return reply({ verified: true });
      }
      if (data.purpose !== "SETUP_PRACTICE" || typeof data.challenge_id !== "string" || !/^[0-9]{6}$/.test(data.demo_code) || typeof data.expires_at !== "string") throw new Error();
      return reply({ challenge_id: data.challenge_id, demo_code: data.demo_code, expires_at: data.expires_at }, upstream.status);
    } catch { return reply({ message: "The test could not be confirmed. Refresh the account or request a new code after 30 seconds." }, 502); }
  }

  if (action === "simulate-collection" || action === "settle-bank") {
    const token = request.cookies.get(COOKIE)?.value;
    if (!token) return reply({ message: "Please sign in again." }, 401);
    const key = request.headers.get("Idempotency-Key") ?? "";
    if (action === "simulate-collection" && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)) return reply({ message: "A valid payment request ID is required." }, 422);
    let body;
    try {
      const input = await request.json();
      if (!input || Array.isArray(input) || typeof input !== "object") throw new Error();
      body = { partner_id: input.partner_id, collection_id: action === "settle-bank" ? input.collection_id : undefined, payer_name: input.payer_name, amount: input.amount,
        provider_code: input.provider_code, result: input.result, failure_code: input.failure_code };
      if (!Number.isSafeInteger(body.partner_id) || body.partner_id <= 0) throw new Error();
    } catch { return reply({ message: "Choose a business and enter valid payment details." }, 422); }
    try {
      const upstream = await fetchWalletPortal(portalUrl(`v1/wallet/${action}`), { token, body, idempotencyKey: key, timeoutMs: 30000 });
      if (upstream.status === 422) return reply({ message: "Check the payer, whole-shilling amount (1–1,000,000,000), network and result." }, 422);
      if (upstream.status === 409) return reply({ message: "This request ID already belongs to a different payment." }, 409);
      if (upstream.status === 404) return reply({ message: "Payment simulation is disabled on this server." }, 404);
      if (!upstream.ok) return portalError(upstream.status);
      return reply({ collection: readSimulatedCollection(await upstream.json()) }, upstream.status);
    } catch {
      return reply({ message: "The payment result could not be confirmed. Retry this same payment safely." }, 502);
    }
  }

  let credentials: { email?: unknown; password?: unknown };
  try {
    credentials = await request.json();
    if (!credentials || typeof credentials !== "object") throw new Error("Invalid credentials.");
  } catch {
    return reply({ message: "Enter your email address and password." }, 400);
  }
  if (typeof credentials.email !== "string" || !credentials.email.trim() || credentials.email.length > 254
    || typeof credentials.password !== "string" || !credentials.password || credentials.password.length > 1024) {
    return reply({ message: "Enter your email address and password." }, 422);
  }
  try {
    const upstream = await portal("mobile/v1/login", undefined, { email: credentials.email.trim(), password: credentials.password }, WALLET_LOGIN_TIMEOUT_MS);
    if (upstream.status === 401 || upstream.status === 422) return reply({ message: "The email address or password is incorrect. Please try again." }, 401);
    if (!upstream.ok) return portalError(upstream.status);
    const payload = await upstream.json();
    const token: unknown = payload?.data?.token;
    if (payload?.success !== true || typeof token !== "string" || token.length < 16 || token.length > 3800 || !/^[A-Za-z0-9._~-]+$/.test(token)) {
      throw new Error("Invalid sign-in response.");
    }
    const response = reply({ success: true });
    response.cookies.set(COOKIE, token, {
      httpOnly: true, secure: frontend.protocol === "https:", sameSite: "strict", path: "/api/wallet", maxAge: 15 * 60,
    });
    return response;
  } catch (error) {
    const failure = walletLoginFailure(error);
    return reply({ message: failure.message }, failure.status);
  }
}

