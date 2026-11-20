"use client";
import { useEffect, useRef, useState } from "react";
import { formatTZS } from "./wallet-data";
import type { WalletWithdrawals } from "./wallet-data";
import { walletBrowserRequest } from "./wallet-request";

type Action = { withdrawal_id: string; action: string; reason: string };
export default function WalletWithdrawalsView({ partnerId, controls = false, refreshToken = 0 }: { partnerId: number; controls?: boolean; refreshToken?: number }) {
  const [page, setPage] = useState(1), [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState<{ data?: WalletWithdrawals; error?: string } | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [pending, setPending] = useState<Action | null>(null);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  useEffect(() => {
    const controller = new AbortController();
    walletBrowserRequest(`/api/wallet/withdrawals?partner_id=${partnerId}&page=${page}`, { signal: controller.signal })
      .then(({ response, data }) => { if (!controller.signal.aborted) setLoaded(response.ok ? { data } : { error: data.message }); })
      .catch(() => { if (!controller.signal.aborted) setLoaded({ error: "Cannot load withdrawals. Please refresh." }); });
    return () => controller.abort();
  }, [partnerId, page, revision, refreshToken]);
  async function run(payload: Action) {
    const controller = new AbortController(); active.current = controller;
    setBusy(true); setMessage(""); setPending(payload);
    try {
      const endpoint = ["APPROVE", "REJECT"].includes(payload.action) ? "withdrawal-decision" : "withdrawal-transfer";
      const { response, data } = await walletBrowserRequest(`/api/wallet/${endpoint}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ partner_id: partnerId, ...payload }), signal: controller.signal }, 35000);
      if (controller.signal.aborted) return;
      if (!response.ok) {
        setMessage(response.status >= 500 ? "The result is uncertain. Use Retry same action below." : data.message);
        if (response.status < 500) setPending(null);
        return;
      }
      setPending(null); setReason(""); setMessage(`Recorded: ${data.withdrawal.status.replaceAll("_", " ").toLowerCase()}.`);
      setLoaded(null); setRevision(value => value + 1);
    } catch { if (!controller.signal.aborted) setMessage("The result is uncertain. Use Retry same action below."); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  const data = loaded?.data;
  return <section className="card"><div className="card-body"><div className="d-flex justify-content-between flex-wrap gap-2 mb-3"><h2 className="h5">Withdrawal requests</h2><button className="btn btn-outline-primary btn-sm" onClick={() => { setLoaded(null); setRevision(value => value + 1); }}>Refresh withdrawals</button></div>
    <p>Awaiting approval and processing keep funds reserved. Rejection or confirmed failure returns them to available. Settlement completes the payout and charge.</p>
    {controls && <p className="alert alert-warning">Simulation controls. No real bank is contacted. A different assigned checker must approve or reject. An unconfirmed transfer stays Processing with funds reserved.</p>}
    {message && <p className="alert alert-info" role="status">{message}</p>}
    {pending && <button className="btn btn-primary mb-3" disabled={busy} onClick={() => run(pending)}>{busy ? "Recording…" : "Retry same action"}</button>}
    {controls && loaded?.data?.can_check && <div className="mb-3"><label htmlFor="withdrawal-decision-reason" className="form-label">Rejection or failure reason</label><input id="withdrawal-decision-reason" className="form-control" value={reason} onChange={e => setReason(e.target.value)} maxLength={200} disabled={busy || pending !== null} /></div>}
    {controls && loaded?.data && !loaded.data.can_check && <p>Sign in as an assigned checker to review another user’s request.</p>}
    {!loaded && <p role="status">Loading withdrawals…</p>}{loaded?.error && <p className="alert alert-danger" role="alert">{loaded.error}</p>}
    {data && (data.items.length === 0 ? <p>No withdrawal requests yet.</p> : <div className="table-responsive"><table className="table align-middle"><caption>Whole TZS · Dates in East Africa Time</caption><thead><tr><th scope="col">Reference</th><th scope="col">Destination</th><th scope="col">Wallet amount</th><th scope="col">Charge</th><th scope="col">Bank receives</th><th scope="col">Status</th><th scope="col">Requested</th></tr></thead><tbody>{data.items.map(item => <tr key={item.id}><td className="text-break">{item.reference}{item.is_simulated && <span className="badge bg-warning text-dark d-block">Simulation</span>}</td><td>{item.bank_name}<br />{item.masked_number}</td><td>{formatTZS(item.amount)}</td><td>{formatTZS(item.fee)}</td><td>{formatTZS(item.net_amount)}</td><td>{item.status === "AWAITING_APPROVAL" ? "Awaiting approval" : item.status}</td><td>{new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Dar_es_Salaam", dateStyle: "medium", timeStyle: "short" }).format(new Date(item.requested_at))}</td></tr>)}</tbody></table></div>)}
    {data && <nav aria-label="Withdrawal pages" className="d-flex justify-content-between align-items-center gap-2"><button className="btn btn-outline-secondary btn-sm" disabled={page <= 1} onClick={() => { setLoaded(null); setPage(value => value - 1); }}>Previous</button><span>Page {data.page} of {data.last_page} · {data.total} requests</span><button className="btn btn-outline-secondary btn-sm" disabled={page >= data.last_page} onClick={() => { setLoaded(null); setPage(value => value + 1); }}>Next</button></nav>}
    {data?.items.map(item => <div className="border rounded p-3 mt-3" key={`decision-${item.id}`}><strong className="text-break">{item.reference}</strong>
      {item.checked_by !== null && item.checked_by !== undefined && <p className="mb-1">Checked by user #{item.checked_by}</p>}
      {(item.decision_reason || item.failure_reason) && <p className="mb-1">Reason: {item.failure_reason ?? item.decision_reason}</p>}
      {controls && data.can_check && item.requested_by === data.actor_id && <p>You cannot check your own request.</p>}
      {controls && data.can_check && item.is_simulated && item.requested_by !== data.actor_id && <div className="d-flex flex-wrap gap-2 mt-2">{(item.status === "AWAITING_APPROVAL" ? [["APPROVE", "Approve"], ["REJECT", "Reject"]] : item.status === "APPROVED" ? [["PROCESSING", "Start simulated transfer"]] : item.status === "PROCESSING" ? [["SETTLED", "Confirm simulated success"], ["FAILED", "Confirm simulated failure"]] : []).map(([action, label]) => <button key={action} className="btn btn-outline-primary btn-sm" disabled={busy || pending !== null || (["REJECT", "FAILED"].includes(action) && !reason.trim())} onClick={() => run({ withdrawal_id: item.id, action, reason: ["REJECT", "FAILED"].includes(action) ? reason.trim() : "" })}>{label}</button>)}</div>}
    </div>)}
  </div></section>;
}
