"use client";
import { useEffect, useRef, useState } from "react";
import { formatTZS } from "./wallet-data";
import type { WalletCollection, WalletCollections } from "./wallet-data";
import { walletBrowserRequest } from "./wallet-request";

const labels = { COMPLETED: "Completed", CLEARING: "In bank clearing", FAILED: "Failed" };
function date(value: string | null) {
  return value ? new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Dar_es_Salaam", dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) + " EAT" : "—";
}

export default function WalletCollectionsView({ partnerId }: { partnerId: number }) {
  const [status, setStatus] = useState("");
  const [channel, setChannel] = useState("");
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState<{ data?: WalletCollections; error?: string } | null>(null);
  const [detail, setDetail] = useState<{ data?: WalletCollection; error?: string; loading?: boolean } | null>(null);
  const detailRequest = useRef<AbortController | null>(null);
  useEffect(() => () => detailRequest.current?.abort(), []);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const query = new URLSearchParams({ partner_id: String(partnerId), page: String(page), status, channel });
        const { response, data } = await walletBrowserRequest(`/api/wallet/collections?${query}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setLoaded(response.ok ? { data } : { error: data.message });
      } catch { if (!controller.signal.aborted) setLoaded({ error: "Cannot load collections. Please try again." }); }
    }
    void load(); return () => controller.abort();
  }, [partnerId, page, status, channel, revision]);

  function reset() { setLoaded(null); detailRequest.current?.abort(); setDetail(null); }
  async function open(id: string) {
    detailRequest.current?.abort();
    const controller = new AbortController(); detailRequest.current = controller;
    setDetail({ loading: true });
    try {
      const { response, data } = await walletBrowserRequest(`/api/wallet/collections?partner_id=${partnerId}&collection_id=${encodeURIComponent(id)}`, { signal: controller.signal });
      if (!controller.signal.aborted) setDetail(response.ok ? { data: data.collection } : { error: data.message });
    } catch { if (!controller.signal.aborted) setDetail({ error: "Cannot load this payment. Close and try again." }); }
  }
  const data = loaded?.data;
  return <>
    <section className="card"><div className="card-body">
      <div className="d-flex justify-content-between align-items-end flex-wrap gap-3 mb-3">
        <div><label htmlFor="collection-status" className="form-label">Status</label><select id="collection-status" className="form-select" value={status} onChange={e => { reset(); setPage(1); setStatus(e.target.value); }}><option value="">All statuses</option>{Object.entries(labels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div>
        <div><label htmlFor="collection-channel" className="form-label">Payment type</label><select id="collection-channel" className="form-select" value={channel} onChange={e => { reset(); setPage(1); setChannel(e.target.value); }}><option value="">All types</option><option value="MNO">Mobile money</option><option value="BANK">Bank</option></select></div>
        <button className="btn btn-outline-primary btn-sm" onClick={() => { reset(); setRevision(value => value + 1); }}>Refresh collections</button>
      </div>
      {!loaded && <p role="status">Loading collections…</p>}
      {loaded?.error && <p className="alert alert-danger" role="alert">{loaded.error}</p>}
      {data && (data.items.length === 0 ? <p>No payments match this selection.</p> : <div className="table-responsive"><table className="table table-hover align-middle"><caption>Payments for the selected business · Dates shown in EAT</caption><thead><tr><th scope="col">Reference</th><th scope="col">Payer</th><th scope="col">Provider</th><th scope="col">Amount</th><th scope="col">Status</th><th scope="col">Date</th><th scope="col">Details</th></tr></thead><tbody>{data.items.map(item => <tr key={item.id}><td>{item.reference}{item.is_simulated && <span className="badge bg-warning text-dark d-block mt-1">Simulation</span>}</td><td>{item.payer_name}</td><td>{item.provider_name}</td><td className="text-nowrap">{formatTZS(item.amount)}</td><td>{labels[item.status]}</td><td>{date(item.attempted_at)}</td><td><button className="btn btn-outline-primary btn-sm" aria-label={`View payment ${item.reference}`} onClick={() => open(item.id)}>View</button></td></tr>)}</tbody></table></div>)}
      {data && <nav aria-label="Collections pages" className="d-flex align-items-center justify-content-between gap-2"><button className="btn btn-outline-secondary btn-sm" disabled={page <= 1} onClick={() => { reset(); setPage(value => value - 1); }}>Previous</button><span>Page {data.page} of {data.last_page} · {data.total} payments</span><button className="btn btn-outline-secondary btn-sm" disabled={page >= data.last_page} onClick={() => { reset(); setPage(value => value + 1); }}>Next</button></nav>}
    </div></section>
    {detail && <section className="card" aria-labelledby="collection-detail-title"><div className="card-body"><div className="d-flex justify-content-between mb-3"><h2 id="collection-detail-title" className="h5">Payment details</h2><button className="btn btn-outline-secondary btn-sm" onClick={() => { detailRequest.current?.abort(); setDetail(null); }}>Close details</button></div>
      {detail.loading && <p role="status">Loading payment details…</p>}
      {detail.error && <p role="alert">{detail.error}</p>}
      {detail.data && <dl className="row mb-0">{Object.entries({ Reference: detail.data.reference, Payer: detail.data.payer_name, Amount: formatTZS(detail.data.amount), Provider: detail.data.provider_name, Type: detail.data.channel_type === "BANK" ? "Bank" : "Mobile money", Status: labels[detail.data.status], Mode: detail.data.is_simulated ? "Simulation — no real money moved" : "Live", "Payment attempted": date(detail.data.attempted_at), "Funds available since": date(detail.data.collected_at), "Failure reason": detail.data.failure_reason ?? "—" }).map(([label, value]) => <div className="row" key={label}><dt className="col-sm-4">{label}</dt><dd className="col-sm-8">{value}</dd></div>)}</dl>}
    </div></section>}
  </>;
}
