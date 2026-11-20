"use client";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { formatTZS } from "./wallet-data";
import type { WithdrawalQuote, WalletWithdrawal } from "./wallet-data";
import { walletBrowserRequest } from "./wallet-request";

type Attempt = { key: string; amount: string; challenge_id: string; code: string };
export default function WalletWithdrawalSimulator({ partnerId, onRecorded }: { partnerId: number; onRecorded: () => void }) {
  const [amount, setAmount] = useState("50000");
  const [quote, setQuote] = useState<(WithdrawalQuote & { key: string }) | null>(null);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [withdrawal, setWithdrawal] = useState<WalletWithdrawal | null>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  async function issue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const key = crypto.randomUUID();
    const controller = new AbortController(); active.current = controller;
    setBusy(true); setMessage(""); setWithdrawal(null);
    try {
      const { response, data } = await walletBrowserRequest("/api/wallet/withdrawal-otp", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": key }, body: JSON.stringify({ partner_id: partnerId, amount }), signal: controller.signal }, 35000);
      if (controller.signal.aborted) return;
      if (!response.ok) { setMessage(data.message); return; }
      setQuote({ ...data, key });
    } catch { if (!controller.signal.aborted) setMessage("Cannot confirm the code request. Wait 30 seconds, then request a new code."); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!quote) return;
    const fields = new FormData(event.currentTarget);
    const pending = attempt ?? { key: quote.key, amount: quote.amount, challenge_id: quote.challenge_id, code: String(fields.get("code") ?? "") };
    const controller = new AbortController(); active.current = controller;
    setAttempt(pending); setBusy(true); setMessage("");
    try {
      const { response, data } = await walletBrowserRequest("/api/wallet/withdrawals", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": pending.key }, body: JSON.stringify({ partner_id: partnerId, amount: pending.amount, challenge_id: pending.challenge_id, code: pending.code }), signal: controller.signal }, 35000);
      if (controller.signal.aborted) return;
      if (!response.ok) {
        setMessage(response.status >= 500 ? "The result is uncertain. Keep this page open and use Retry same withdrawal." : data.message);
        if (response.status < 500) { setAttempt(null); if ([404, 409, 410, 423].includes(response.status)) setQuote(null); }
        return;
      }
      setWithdrawal(data.withdrawal); setQuote(null); setAttempt(null); onRecorded();
    } catch { if (!controller.signal.aborted) setMessage("The result is uncertain. Keep this page open and use Retry same withdrawal."); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  return <section className="card"><div className="card-body"><h2 className="h5">Test a withdrawal request</h2><p className="alert alert-warning">Simulation. This reserves test funds and waits for approval. No money is sent to a bank. The illustrative charge is TZS 2,500, deducted from the requested amount.</p>
    {message && <p className="alert alert-info" role="status">{message}</p>}
    {!quote ? <form onSubmit={issue}><label htmlFor="withdrawal-amount" className="form-label">Total amount to reserve (TZS)</label><input id="withdrawal-amount" className="form-control mb-3" type="number" min={2501} max={1000000000} step={1} required value={amount} onChange={e => setAmount(e.target.value)} disabled={busy} /><button className="btn btn-primary" disabled={busy}>Request withdrawal OTP</button></form> : <form onSubmit={submit}>
      <dl className="row"><dt className="col-sm-4">Destination</dt><dd className="col-sm-8">{quote.bank_name} {quote.masked_number}</dd><dt className="col-sm-4">Reserve</dt><dd className="col-sm-8">{formatTZS(quote.amount)}</dd><dt className="col-sm-4">Example charge</dt><dd className="col-sm-8">{formatTZS(quote.fee)}</dd><dt className="col-sm-4">Bank receives after approval</dt><dd className="col-sm-8">{formatTZS(quote.net_amount)}</dd></dl>
      <p>Demo code: <strong>{quote.demo_code}</strong>. Expires at {new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Dar_es_Salaam", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(quote.expires_at))} EAT. This code only confirms these withdrawal details.</p>
      <fieldset disabled={busy || attempt !== null}><label htmlFor="withdrawal-code" className="form-label">Six-digit code</label><input id="withdrawal-code" name="code" className="form-control mb-3" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required /></fieldset>
      <div className="d-flex gap-2"><button className="btn btn-primary" disabled={busy}>{busy ? "Submitting…" : attempt ? "Retry same withdrawal" : "Confirm and reserve funds"}</button><button className="btn btn-outline-secondary" type="button" disabled={busy || attempt !== null} onClick={() => { setQuote(null); setMessage(""); }}>Change details</button></div>
    </form>}
    {withdrawal && <div className="alert alert-success mt-3" role="status"><strong>Request saved — awaiting approval</strong><p>{formatTZS(withdrawal.amount)} is now reserved. It cannot be spent again while this request is pending.</p><small className="text-break">{withdrawal.reference}</small></div>}
  </div></section>;
}
