"use client";
import { useEffect, useState } from "react";
import { formatTZS } from "./wallet-data";
import type { WalletStatement } from "./wallet-data";
import { walletBrowserRequest } from "./wallet-request";

const buckets = ["available", "clearing", "reserved"] as const;
function change(value: string) {
  return value === "0" ? "—" : `${value.startsWith("-") ? "−" : "+"}${formatTZS(value.replace(/^-/, ""))}`;
}

export default function WalletStatementView({ partnerId }: { partnerId: number }) {
  const [page, setPage] = useState(1);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState<{ data?: WalletStatement; error?: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const query = new URLSearchParams({ partner_id: String(partnerId), page: String(page) });
        if (anchor !== null) query.set("anchor", anchor);
        const { response, data } = await walletBrowserRequest(`/api/wallet/statement?${query}`, { signal: controller.signal });
        if (!controller.signal.aborted) setLoaded(response.ok ? { data } : { error: data.message });
      } catch { if (!controller.signal.aborted) setLoaded({ error: "Cannot load your statement. Please refresh to try again." }); }
    }
    void load(); return () => controller.abort();
  }, [partnerId, page, anchor, revision]);
  function navigate(next: number) { setAnchor(loaded?.data?.anchor ?? null); setLoaded(null); setPage(next); }
  const data = loaded?.data;
  return <section className="card"><div className="card-body">
    <div className="d-flex justify-content-between align-items-start flex-wrap gap-3 mb-3"><div><h2 className="h5">Wallet statement</h2><p className="text-muted mb-0">Oldest movement first. Each row shows changes and the balances immediately afterward. Internal transfers move money between balances.</p></div><button className="btn btn-outline-primary btn-sm" onClick={() => { setLoaded(null); setAnchor(null); setPage(1); setRevision(value => value + 1); }}>Refresh statement</button></div>
    <p className="text-muted">Failed payment attempts have no money movement; see Collections for those. Refresh to include new movements.</p>
    {!loaded && <p role="status">Loading statement…</p>}
    {loaded?.error && <p className="alert alert-danger" role="alert">{loaded.error}</p>}
    {data && (data.items.length === 0 ? <p>No wallet movements yet.</p> : <div className="table-responsive"><table className="table table-bordered align-middle"><caption>All amounts in TZS · Dates in East Africa Time (EAT)</caption><thead><tr><th scope="col">Date / Reference</th>{buckets.map(bucket => <th scope="col" key={bucket} className="text-capitalize">{bucket}<small className="d-block text-muted">Change / balance after</small></th>)}</tr></thead><tbody>{data.items.map(row => <tr key={row.id}><td><div>{new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Dar_es_Salaam", dateStyle: "medium", timeStyle: "short" }).format(new Date(row.posted_at))}</div><div>{row.reversal ? "Reversal" : row.changes.clearing.startsWith("-") && BigInt(row.changes.available) > BigInt(0) ? "Bank settlement" : row.reference_type === "COLLECTION" ? "Collection" : row.reference_type}</div><small className="text-break">{row.reference}</small></td>{buckets.map(bucket => <td className="text-nowrap" key={bucket}><div>{change(row.changes[bucket])}</div><strong>{formatTZS(row.balances[bucket])}</strong></td>)}</tr>)}</tbody></table></div>)}
    {data && <nav aria-label="Statement pages" className="d-flex align-items-center justify-content-between gap-2"><button className="btn btn-outline-secondary btn-sm" disabled={page <= 1} onClick={() => navigate(page - 1)}>Previous</button><span>Page {data.page} of {data.last_page} · {data.total} movements</span><button className="btn btn-outline-secondary btn-sm" disabled={page >= data.last_page} onClick={() => navigate(page + 1)}>Next</button></nav>}
  </div></section>;
}

