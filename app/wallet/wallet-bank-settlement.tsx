"use client";
import { useEffect, useRef, useState } from "react";
import { walletBrowserRequest } from "./wallet-request";
import { formatTZS } from "./wallet-data";

export default function WalletBankSettlement({ partnerId, onRecorded }: { partnerId: number; onRecorded: () => void }) {
  const [items, setItems] = useState<{ id: string; reference: string; amount: string }[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const active = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const { response, data } = await walletBrowserRequest(`/api/wallet/pending-banks?partner_id=${partnerId}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (!response.ok) throw new Error();
        setItems(data.items);
      } catch { if (!controller.signal.aborted) setMessage("Cannot load pending bank tests. Please refresh."); }
    }
    void load(); const timer = setInterval(() => { void load(); }, 5000);
    return () => { controller.abort(); active.current?.abort(); clearInterval(timer); };
  }, [partnerId]);

  async function settle(id: string) {
    const controller = new AbortController(); active.current = controller;
    setBusy(true); setMessage("");
    try {
      const { response } = await walletBrowserRequest("/api/wallet/settle-bank", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partner_id: partnerId, collection_id: id }), signal: controller.signal,
      }, 35000);
      if (controller.signal.aborted) return;
      if (!response.ok) throw new Error();
      setItems(items => items.filter(item => item.id !== id));
      setMessage("Bank test settled. Its money is now available."); onRecorded();
    } catch { if (!controller.signal.aborted) setMessage("Settlement could not be confirmed. You can retry safely; the same payment can only settle once."); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  return <section className="card"><div className="card-body">
    <h3 className="h5">Simulate bank settlement</h3>
    <p className="text-muted">Pending bank tests appear here. Settlement moves their money from clearing to available. No real bank is contacted.</p>
    {message && <p role="status" className="alert alert-info">{message}</p>}
    {!items.length && <p>No pending bank tests.</p>}
    {items.map(item => <div className="d-flex justify-content-between flex-wrap gap-2 mb-3" key={item.id}><span>{item.reference} · {formatTZS(item.amount)}</span><button className="btn btn-outline-primary btn-sm" disabled={busy} onClick={() => settle(item.id)}>{busy ? "Settling…" : "Simulate settlement"}</button></div>)}
  </div></section>;
}
