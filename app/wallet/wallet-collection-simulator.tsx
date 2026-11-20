"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { formatTZS } from "./wallet-data";
import type { SimulatedCollection } from "./wallet-data";
import { walletBrowserRequest } from "./wallet-request";

type Attempt = { key: string; body: { partner_id: number; payer_name: string; amount: string; provider_code: string; result: string; failure_code?: string } };

export default function WalletCollectionSimulator({ partnerId, onRecorded }: { partnerId: number; onRecorded: () => void }) {
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Attempt | null>(null);
  const [result, setResult] = useState("COMPLETED");
  const [message, setMessage] = useState("");
  const [collection, setCollection] = useState<SimulatedCollection | null>(null);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => { active.current?.abort(); }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const attempt = pending ?? {
      key: crypto.randomUUID(),
      body: { partner_id: partnerId, payer_name: String(fields.get("payer_name") ?? "").trim(),
        amount: String(fields.get("amount") ?? ""), provider_code: String(fields.get("provider_code")),
        result, ...(result === "FAILED" ? { failure_code: String(fields.get("failure_code")) } : {}) },
    };
    const controller = new AbortController();
    active.current = controller;
    setPending(attempt); setBusy(true); setMessage(""); setCollection(null);
    try {
      const { response, data } = await walletBrowserRequest("/api/wallet/simulate-collection", {
        method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": attempt.key },
        body: JSON.stringify(attempt.body), signal: controller.signal,
      }, 35000);
      if (controller.signal.aborted) return;
      if (!response.ok) {
        if (response.status < 500) setPending(null);
        setMessage(response.status >= 500 ? "The result is uncertain. Use Retry same payment below. Keep this page open until confirmed." : data.message);
        return;
      }
      setCollection(data.collection as SimulatedCollection); setPending(null); onRecorded();
    } catch {
      if (!controller.signal.aborted) setMessage("The result is uncertain. Use Retry same payment below. Keep this page open until confirmed.");
    } finally { if (!controller.signal.aborted) setBusy(false); }
  }

  return <section className="card wallet-simulator" aria-labelledby="wallet-simulator-title">
    <div className="card-body">
      <div className="d-flex align-items-center gap-2 mb-2"><h3 className="h5 mb-0" id="wallet-simulator-title">Test a payment</h3><span className="badge bg-warning text-dark">Simulation</span></div>
      <p className="text-muted">For learning only. No customer is charged. Mobile money becomes available immediately. Bank payments wait in clearing until you simulate settlement.</p>
      <form onSubmit={submit}>
        <fieldset disabled={busy || pending !== null}>
          <div className="row g-3">
            <div className="col-md-6"><label htmlFor="simulation-payer" className="form-label">Payer name</label><input id="simulation-payer" name="payer_name" className="form-control" required maxLength={100} defaultValue="Test Customer" /></div>
            <div className="col-md-6"><label htmlFor="simulation-amount" className="form-label">Amount (TZS)</label><input id="simulation-amount" name="amount" type="number" className="form-control" required min={1} max={1000000000} step={1} defaultValue="50000" /></div>
            <div className="col-md-6"><label htmlFor="simulation-provider" className="form-label">Mobile network or bank</label><select id="simulation-provider" name="provider_code" className="form-select"><option value="MPESA">M-Pesa</option><option value="AIRTEL">Airtel Money</option><option value="YAS">Mixx by Yas</option><option value="HALOPESA">HaloPesa</option><option value="BANK_SIM">Test Bank (clearing first)</option></select></div>
            <div className="col-md-6"><label htmlFor="simulation-result" className="form-label">Test result</label><select id="simulation-result" className="form-select" value={result} onChange={event => setResult(event.target.value)}><option value="COMPLETED">Successful payment</option><option value="FAILED">Failed payment</option></select></div>
            {result === "FAILED" && <div className="col-md-6"><label htmlFor="simulation-failure" className="form-label">Failure reason</label><select id="simulation-failure" name="failure_code" className="form-select"><option value="INSUFFICIENT_BALANCE">Insufficient wallet balance</option><option value="PIN_TIMEOUT">Customer PIN timeout</option><option value="DAILY_LIMIT_REACHED">Wallet daily limit reached</option></select></div>}
          </div>
        </fieldset>
        {message && <p className="alert alert-warning mt-3 mb-0" role="alert">{message}</p>}
        <button className="btn btn-primary mt-3" type="submit" disabled={busy}>{busy ? "Recording test payment…" : pending ? "Retry same payment" : "Simulate payment"}</button>
      </form>
      {collection && <div className={`alert ${collection.status === "COMPLETED" ? "alert-success" : "alert-warning"} mt-3 mb-0`} role="status">
        <strong>{collection.status === "COMPLETED" ? "Test payment successful" : collection.status === "CLEARING" ? "Waiting for bank settlement" : "Test payment failed"}</strong>
        <p className="mb-1">{formatTZS(collection.amount)} · {collection.provider_name} · {collection.payer_name}</p>
        <p className="mb-1">{collection.status === "COMPLETED" ? "Added to available balance." : collection.status === "CLEARING" ? "Added to bank clearing. Settle it below when ready." : `${collection.failure_reason}. Your balance has not changed.`}</p>
        <small>Reference: {collection.reference}</small>
      </div>}
    </div>
  </section>;
}

