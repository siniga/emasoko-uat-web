import { NextRequest } from "next/server";

// Keep portal connectivity server-side; Cybersource keys stay in Laravel.
export async function POST(request: NextRequest, context: { params: Promise<{ action: string }> }) {
  if (process.env.NODE_ENV !== "development" && process.env.CHECKOUT_ENABLED !== "true") {
    return Response.json({ message: "This checkout is currently available for local testing only." }, { status: 404 });
  }
  // Configure the public frontend origin when HTTPS terminates at a proxy.
  const checkoutOrigin = process.env.CHECKOUT_ORIGIN ?? request.nextUrl.origin;
  if (request.headers.get("origin") !== checkoutOrigin) {
    return Response.json({ message: "Checkout requests must come from this application." }, { status: 403 });
  }
  const { action } = await context.params;
  if (action !== "context" && action !== "authorize") {
    return Response.json({ message: "Unknown checkout action." }, { status: 404 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ message: "Send a valid JSON request." }, { status: 400 });
  }
  const portal = (process.env.PORTAL_API_URL ?? "https://165.245.192.26/api").replace(/\/$/, "");
  try {
    const response = await fetch(`${portal}/cybersource/checkout/${action}`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(60000),
    });
    const data = await response.json();
    // Laravel debug traces are never forwarded to the browser.
    return Response.json({
      success: data.success ?? false,
      message: data.message,
      errors: data.errors,
      checkout_id: data.checkout_id,
      reference: data.reference,
      amount: data.amount,
      currency: data.currency,
      capture_context: data.capture_context,
      client_library: data.client_library,
      client_library_integrity: data.client_library_integrity,
      expires_at: data.expires_at,
      target_origin: data.target_origin,
      environment: data.environment,
      payment_id: data.payment_id,
      payment_status: data.payment_status,
      authorization_hold_possible: data.authorization_hold_possible,
      error_information: data.error_information,
    }, { status: response.status, headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({
      message: action === "authorize"
        ? "The payment outcome is unconfirmed. Check Business Center before trying another payment."
        : "Cannot reach the portal API. Start Laravel and check PORTAL_API_URL in .env.local.",
      ...(action === "authorize" ? { payment_status: "UNKNOWN" } : {}),
    }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
