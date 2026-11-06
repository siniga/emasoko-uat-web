"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";

type CheckoutSession = {
  checkout_id: string;
  reference: string;
  amount: string;
  currency: string;
  capture_context: string;
  client_library: string;
  client_library_integrity: string;
  expires_at: number;
  target_origin: string;
  environment: "production" | "test";
  flow: "sale-v1";
};
type PaymentResult = {
  success?: boolean;
  paid?: boolean;
  verified?: boolean;
  payment_status?: string;
  payment_id?: string;
  reference?: string;
  message?: string;
  authorization_hold_possible?: boolean;
  error_information?: { reason?: string; message?: string };
};
type UnifiedPayments = {
  show: (options: { containers: { paymentSelection: string; paymentScreen: string } }) => Promise<string>;
  complete: (token: string) => Promise<{ id?: string; details?: { id?: string } }>;
};
type Receipt = { checkout_id: string; reference: string; amount: string; currency: string; payment_id?: string; environment: "production" | "test" };
const receiptKey = "equity-checkout-receipt";
type AcceptInstance = {
  unifiedPayments: (sidebar: boolean) => Promise<UnifiedPayments>;
  dispose: () => void;
};
type PaymentWindow = { Accept?: (context: string) => Promise<AcceptInstance> };
const paymentWindow = () => window as unknown as PaymentWindow;

function loadLibrary(url: string, integrity: string): Promise<void> {
  const parsed = new URL(url);
  const hosts = ["up.cybersource.com", "testup.cybersource.com", "api.cybersource.com", "apitest.cybersource.com"];
  if (parsed.protocol !== "https:" || !hosts.includes(parsed.hostname) || parsed.port || parsed.username || parsed.password
    || !(parsed.pathname.startsWith("/uc/") || parsed.pathname.startsWith("/up/v1/"))
    || !/^sha(256|384|512)-[A-Za-z0-9+/=]+$/.test(integrity)) {
    return Promise.reject(new Error("Checkout returned an unexpected payment library. Please contact support."));
  }
  return new Promise((resolve, reject) => {
    const existing = document.getElementById("equity-payment-library") as HTMLScriptElement | null;
    if (existing?.src === url && existing.integrity === integrity && paymentWindow().Accept) { resolve(); return; }
    existing?.remove();
    const script = document.createElement("script");
    script.id = "equity-payment-library";
    script.src = url;
    script.integrity = integrity;
    script.crossOrigin = "anonymous";
    script.async = true;
    const timeout = window.setTimeout(() => { script.remove(); reject(new Error("The payment form took too long to load. Try again.")); }, 20000);
    script.onload = () => { window.clearTimeout(timeout); resolve(); };
    script.onerror = () => { window.clearTimeout(timeout); script.remove(); reject(new Error("Could not load the secure payment form. Check your connection and browser settings.")); };
    document.head.appendChild(script);
  });
}

async function post(action: string, body: object) {
  const response = await fetch(`/api/equity-checkout/${action}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok && !data.payment_status) {
    const validation = data.errors ? Object.values(data.errors).flat().join(" ") : "";
    throw new Error(validation || data.message || "Checkout request failed. Please try again.");
  }
  return data;
}

const money = (amount: string, currency: string) => `${currency} ${Number(amount || 0).toLocaleString("en-TZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function EquityCheckout() {
  const [amount, setAmount] = useState("1000.00");
  const [currency, setCurrency] = useState("TZS");
  const [session, setSession] = useState<CheckoutSession | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<PaymentResult | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [checking, setChecking] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const [secure, setSecure] = useState<boolean | null>(null);
  const instance = useRef<AcceptInstance | null>(null);
  const paymentsInstance = useRef<UnifiedPayments | null>(null);
  const generation = useRef(0);
  const preparing = useRef(false);
  const authorizing = useRef(false);
  const expired = !!session && remaining <= 0;
  const stage = result ? 3 : token ? 2 : session ? 1 : 0;

  useEffect(() => {
    setSecure(window.location.protocol === "https:");
    try {
      const saved = JSON.parse(sessionStorage.getItem(receiptKey) || "null") as Receipt | null;
      if (saved?.checkout_id && saved.reference) {
        setReceipt(saved); setSubmitted(true);
        if (saved.amount && saved.currency) { setAmount(saved.amount); setCurrency(saved.currency); }
        setResult({ payment_status: "UNKNOWN", reference: saved.reference, message: "Check your previous payment status before making another payment." });
      }
    } catch { /* Storage may be disabled. The server still prevents duplicate submissions. */ }
    return () => { generation.current++; instance.current?.dispose(); };
  }, []);
  useEffect(() => {
    if (!session) return;
    const tick = () => setRemaining(Math.max(0, session.expires_at - Math.floor(Date.now() / 1000)));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [session]);
  useEffect(() => {
    if (!expired || submitted) return;
    generation.current++;
    instance.current?.dispose();
    instance.current = null;
    setCollecting(false);
    setToken(null);
  }, [expired, submitted]);
  useEffect(() => {
    if (!receipt || !submitted || submitting || result?.paid) return;
    let active = true;
    let attempts = 0;
    const timer = window.setInterval(async () => {
      if (++attempts >= 8) window.clearInterval(timer);
      try {
        const data = await post("status", { checkout_id: receipt.checkout_id, payment_id: receipt.payment_id });
        if (active) setResult(data);
        if (data.paid && data.verified) window.clearInterval(timer);
      } catch { /* Keep the last result. Manual status checking remains available. */ }
    }, 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, [receipt, submitted, submitting, result?.paid]);

  async function prepare(event: FormEvent) {
    event.preventDefault();
    if (preparing.current || submitted) return;
    preparing.current = true;
    setBusy(true); setError(""); setResult(null); setToken(null); setConsent(false); setSession(null);
    instance.current?.dispose(); instance.current = null;
    const current = ++generation.current;
    try {
      const data = await post("context", { amount, currency });
      if (current !== generation.current) return;
      if (!data.success || data.flow !== "sale-v1" || !data.capture_context || !data.checkout_id || !data.expires_at) throw new Error("The portal needs the updated payment API. Deploy both checkout applications together.");
      if (data.target_origin !== window.location.origin) throw new Error(`Checkout is configured for ${data.target_origin}. Open that address or update CYBERSOURCE_CHECKOUT_ORIGIN in the portal.`);
      setRemaining(Math.max(0, data.expires_at - Math.floor(Date.now() / 1000)));
      setSession(data);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not prepare checkout."); }
    finally { preparing.current = false; setBusy(false); }
  }

  async function openCardForm() {
    if (!session || collecting || token || expired) return;
    const current = generation.current;
    setCollecting(true); setError("");
    try {
      await loadLibrary(session.client_library, session.client_library_integrity);
      if (current !== generation.current) return;
      const acceptPayment = paymentWindow().Accept;
      if (!acceptPayment) throw new Error("The payment library did not initialize.");
      instance.current?.dispose();
      const accept = await acceptPayment(session.capture_context);
      if (current !== generation.current) { accept.dispose(); return; }
      instance.current = accept;
      const payments = await accept.unifiedPayments(false);
      paymentsInstance.current = payments;
      const transientToken = await payments.show({ containers: {
        paymentSelection: "#equity-payment-selection", paymentScreen: "#equity-payment-screen",
      } });
      if (current !== generation.current) return;
      if (typeof transientToken !== "string" || transientToken.split(".").length !== 3) throw new Error("No valid payment token was returned.");
      setToken(transientToken);
    } catch (e) {
      if (current === generation.current) setError(e instanceof Error ? e.message : "The secure payment form could not be completed. Prepare a new checkout to try again.");
    } finally { if (current === generation.current) setCollecting(false); }
  }

  function saveReceipt(value: Receipt) {
    setReceipt(value);
    try { sessionStorage.setItem(receiptKey, JSON.stringify(value)); } catch { /* No payment credentials are stored. */ }
  }

  async function checkStatus(value = receipt) {
    if (!value || checking) return;
    setChecking(true);
    try { setResult(await post("status", { checkout_id: value.checkout_id, payment_id: value.payment_id })); }
    catch (e) {
      setResult({ paid: false, verified: false, payment_status: "UNKNOWN", reference: value.reference,
        message: e instanceof Error ? e.message : "Could not check payment status. Check Business Center before paying again." });
    }
    finally { setChecking(false); }
  }

  async function authorize() {
    if (!session || !token || !consent || expired || authorizing.current || submitted || !paymentsInstance.current) return;
    authorizing.current = true; setSubmitted(true); setSubmitting(true); setError("");
    let currentReceipt: Receipt = { checkout_id: session.checkout_id, reference: session.reference,
      amount: session.amount, currency: session.currency, environment: session.environment };
    saveReceipt(currentReceipt);
    try {
      const start = await post("begin", { checkout_id: session.checkout_id, transient_token: token });
      if (!start.proceed) throw new Error(start.message || "Payment could not start. Check its reference before trying again.");
      // Keep the SDK containers mounted and visible for any issuer authentication challenge.
      const completion = await paymentsInstance.current.complete(token);
      const paymentId = completion.id || completion.details?.id;
      if (paymentId && /^[0-9]{1,40}$/.test(paymentId)) {
        currentReceipt = { ...currentReceipt, payment_id: paymentId };
        saveReceipt(currentReceipt);
      }
      await checkStatus(currentReceipt);
    } catch (e) {
      setResult({ payment_status: "UNKNOWN", reference: session.reference,
        message: e instanceof Error ? e.message : "Check Business Center for the outcome before making another payment." });
    } finally { setSubmitting(false); setToken(null); }
  }

  const resultTitle = result?.paid && result.verified ? "Payment collected"
    : result?.payment_status === "PENDING" || result?.payment_status === "TRANSMITTED" ? "Payment processing"
    : result?.payment_status === "AUTHORIZED" ? "Payment authorized; collection unconfirmed"
    : result?.payment_status === "AUTHORIZED_RISK_DECLINED" ? "Order rejected after authorization"
    : result?.payment_status === "AUTHORIZED_PENDING_REVIEW" ? "Authorization needs review"
    : result?.payment_status === "PARTIAL_AUTHORIZED" ? "Part of the amount was authorized"
    : result?.payment_status === "DECLINED" ? "Payment declined"
    : result?.payment_status === "UNKNOWN" ? "Payment outcome unconfirmed" : "Payment needs attention";
  const environment = session?.environment || receipt?.environment;

  function newPayment() {
    if (!result?.verified || !result.paid) return;
    try { sessionStorage.removeItem(receiptKey); } catch { /* Storage may be disabled. */ }
    generation.current++; instance.current?.dispose(); instance.current = null; paymentsInstance.current = null;
    authorizing.current = false; setSubmitted(false); setReceipt(null); setResult(null); setSession(null);
    setConsent(false); setError("");
  }

  return (
    <div className="equity-checkout">
      <div className="eq-main">
        <div className="page-title-box d-sm-flex align-items-center justify-content-between">
          <h1 className="mb-sm-0 font-size-18">Equity Checkout</h1>
          <nav aria-label="Breadcrumb"><ol className="breadcrumb m-0"><li className="breadcrumb-item"><Link href="/">eMakato</Link></li><li className="breadcrumb-item active" aria-current="page">Equity Checkout</li></ol></nav>
        </div>
        <div className="eq-heading"><div><p className="wallet-eyebrow">Card payments · Equity</p><h2>Make a card payment</h2><p>Pay securely with your Visa or Mastercard.</p></div><span className="eq-live"><span /> {environment === "production" ? "Live payments" : environment === "test" ? "Test payments" : "Secure checkout"}</span></div>
        <ol className="eq-steps" aria-label="Checkout progress">{["Payment details", "Secure card entry", "Complete payment"].map((label, index) => (
          <li key={label} className={stage >= index ? "is-active" : ""} aria-current={stage === index ? "step" : undefined}><span>{stage > index ? "✓" : index + 1}</span>{label}</li>
        ))}</ol>
        <div className="eq-grid"><div className="eq-content">
          {secure === false && <div className="eq-notice eq-warning" role="alert"><strong>Open checkout over HTTPS</strong><p>Run <code>npm run dev:https</code> and open <a href="https://localhost:3000/equity-checkout">https://localhost:3000/equity-checkout</a>. Cybersource requires the page address to match its configured HTTPS origin.</p></div>}
          {error && <div className="eq-notice eq-error" role="alert"><strong>Checkout needs your attention</strong><p>{error}</p></div>}
          {expired && !submitted && <div className="eq-notice eq-warning" role="alert"><strong>Your checkout session expired</strong><p>Prepare a new checkout below to continue. No payment was submitted from this page.</p></div>}
          <section className="eq-card" aria-labelledby="eq-details-title"><div className="eq-card-heading"><span className="eq-section-icon"><i className="bx bx-receipt" aria-hidden="true" /></span><div><h2 id="eq-details-title">Payment details</h2><p>Choose the amount and currency for this payment.</p></div></div>
            <form onSubmit={prepare}><fieldset disabled={busy || collecting || submitted}><div className="eq-field-grid">
              <div><label htmlFor="eq-amount">Amount</label><input id="eq-amount" name="amount" inputMode="decimal" type="number" min="0.01" max="99999999.99" step="0.01" required value={amount} onChange={e => { setAmount(e.target.value); setSession(null); setToken(null); generation.current++; instance.current?.dispose(); }} /></div>
              <div><label htmlFor="eq-currency">Currency</label><select id="eq-currency" value={currency} onChange={e => { setCurrency(e.target.value); setSession(null); setToken(null); generation.current++; instance.current?.dispose(); }}><option value="TZS">TZS · Tanzanian shilling</option><option value="USD">USD · US dollar</option><option value="KES">KES · Kenyan shilling</option></select></div>
            </div><p className="eq-hint">Use a currency enabled for your merchant account.</p>
              <button className="eq-button eq-primary" disabled={secure !== true || busy || collecting || submitted} type="submit">{busy ? "Preparing checkout…" : session && !expired ? "Prepare a new checkout" : "Prepare checkout"}<span aria-hidden="true">→</span></button>
            </fieldset></form>
            <p className="eq-footnote"><i className="bx bx-info-circle" aria-hidden="true" /> Preparing checkout does not charge your card.</p>
          </section>
          <section className={`eq-card ${!session || expired ? "eq-card-waiting" : ""}`} aria-labelledby="eq-card-title"><div className="eq-card-heading"><span className="eq-section-icon"><i className="bx bx-credit-card" aria-hidden="true" /></span><div><h2 id="eq-card-title">Pay by card</h2><p>Your card details are entered in Cybersource’s secure form.</p></div><div className="eq-networks"><span>VISA</span><span className="eq-mastercard" aria-label="Mastercard"><b /><b /></span></div></div>
            {!session ? <div className="eq-placeholder"><i className="bx bx-lock-alt" aria-hidden="true" /><h3>Your secure payment form will appear here</h3><p>Prepare your checkout to get started.</p></div> : <>
              {!token && !result && !expired && <button type="button" className="eq-button eq-outline" disabled={collecting || busy} onClick={openCardForm}>{collecting ? "Complete the secure form below" : "Open secure card form"}</button>}
              <div id="equity-payment-selection" className="eq-sdk-container" hidden={!submitting && (!!token || !!result || expired)} />
              <div id="equity-payment-screen" className="eq-sdk-container" hidden={!submitting && (!!token || !!result || expired)} />
              {token && !expired && !result && <div className="eq-token-ready"><span aria-hidden="true">✓</span><div><strong>Card details securely collected</strong><p>Ready to pay {money(session.amount, session.currency)}.</p></div></div>}
            </>}
            {token && !expired && !result && <div className="eq-authorize"><label className="eq-consent"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} disabled={submitted} /><span>I authorize a payment of <strong>{money(session!.amount, session!.currency)}</strong> on my card{session?.environment === "test" ? " in the test environment" : ""}.</span></label><button type="button" className="eq-button eq-primary" onClick={authorize} disabled={!consent || submitted || submitting}>{submitting ? "Processing payment…" : `Pay ${money(session!.amount, session!.currency)}`}</button></div>}
            {result && <div className={`eq-result ${result.paid && result.verified ? "eq-result-success" : "eq-result-attention"}`} role="status"><h3>{resultTitle}</h3><p>{result.paid && result.verified ? "CyberSource confirmed that your payment settled." : result.message || result.error_information?.message || "Collection is not yet confirmed. Check this reference before paying again."}</p><dl><dt>Status</dt><dd>{result.payment_status || "UNKNOWN"}</dd>{result.payment_id && <><dt>Payment ID</dt><dd>{result.payment_id}</dd></>}<dt>Reference</dt><dd>{result.reference || session?.reference || receipt?.reference}</dd></dl>{receipt && <button type="button" className="eq-button eq-outline" disabled={checking || submitting} onClick={() => checkStatus()}>{checking ? "Checking…" : "Check payment status"}</button>}{result.paid && result.verified && <button type="button" className="eq-button eq-outline" onClick={newPayment}>Start a new payment</button>}</div>}
          </section>
        </div><aside className="eq-sidebar"><section className="eq-summary"><p className="eq-eyebrow">PAYMENT SUMMARY</p><div className="eq-summary-merchant"><span>eM</span><div><strong>eMakato</strong><p>Equity card payment</p></div></div><div className="eq-summary-row"><span>Payment method</span><strong>Visa / Mastercard</strong></div><div className="eq-summary-row"><span>Currency</span><strong>{session?.currency || currency}</strong></div><div className="eq-total"><span>Payment amount</span><strong>{money(session?.amount || amount, session?.currency || currency)}</strong></div><p className="eq-summary-note">Payment requests include authorization and capture. Collection is confirmed after settlement.</p>{session && <div className="eq-session-info"><span>{expired ? "Session expired" : `Session active · ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`}</span><small>Reference</small><code>{session.reference}</code></div>}</section>
          <div className="eq-live-note"><i className="bx bx-info-circle" aria-hidden="true" /><div><strong>{environment === "production" ? "You are using production" : environment === "test" ? "You are using the test environment" : "Secure card payments"}</strong><p>{environment === "production" ? "Paying will request a real charge. " : ""}Complete any bank verification when prompted. Check uncertain outcomes before paying again.</p></div></div>
          <div className="eq-trust"><i className="bx bx-shield-quarter" aria-hidden="true" /><span>Card details handled by Cybersource<br /><small>Visa Acceptance Solutions</small></span></div>
        </aside></div>
      </div>
    </div>
  );
}
