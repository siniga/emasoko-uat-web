"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { formatTZS, readWalletContext } from "./wallet-data";
import { walletBrowserRequest } from "./wallet-request";
import type { WalletContext, WalletSummary } from "./wallet-data";
import WalletCollectionSimulator from "./wallet-collection-simulator";
import WalletBankSettlement from "./wallet-bank-settlement";
import WalletCollectionsView from "./wallet-collections";
import WalletStatementView from "./wallet-statement";
import WalletBankAccount from "./wallet-bank-account";
import WalletWithdrawalSimulator from "./wallet-withdrawal-simulator";
import WalletWithdrawalsView from "./wallet-withdrawals";

type SessionState = "loading" | "signed-out" | "ready" | "blocked" | "error";
type BalanceState = { partnerId: number; data?: WalletSummary; error?: string; updatedAt?: number };

export default function WalletOverview({ view = "overview" }: { view?: "overview" | "simulations" | "collections" | "statement" | "withdrawals" }) {
  const [state, setState] = useState<SessionState>("loading");
  const [context, setContext] = useState<WalletContext | null>(null);
  const [partnerId, setPartnerId] = useState<number | null>(null);
  const [balances, setBalances] = useState<BalanceState | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [sessionRevision, setSessionRevision] = useState(0);
  const [refreshRevision, setRefreshRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    async function loadContext() {
      try {
        const { response, data } = await walletBrowserRequest("/api/wallet/context", { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (!response.ok) {
          setContext(null);
          setBalances(null);
          setState(response.status === 401 ? "signed-out" : response.status === 403 ? "blocked" : "error");
          setMessage(response.status === 401 ? "" : data.message);
          return;
        }
        const loaded = readWalletContext({ success: true, data });
        setContext(loaded);
        setPartnerId(current => loaded.businesses.some(business => business.id === current) ? current : loaded.businesses[0].id);
        setState("ready");
        setMessage("");
      } catch {
        if (!controller.signal.aborted) { setState("error"); setMessage("We cannot load your wallet right now. Please try again."); }
      }
    }
    void loadContext();
    return () => controller.abort();
  }, [sessionRevision]);

  useEffect(() => {
    if (view !== "overview" || state !== "ready" || partnerId === null) return;
    const controller = new AbortController();
    const businessId = partnerId;
    let inFlight = false;
    async function loadBalances() {
      if (inFlight) return;
      inFlight = true;
      try {
        const { response, data } = await walletBrowserRequest(`/api/wallet/summary?partner_id=${businessId}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (!response.ok) {
          if (response.status === 401) {
            setState("signed-out"); setContext(null); setBalances(null); setMessage("Your session ended. Please sign in again.");
          } else {
            setBalances({ partnerId: businessId, error: data.message });
          }
          return;
        }
        setBalances({ partnerId: businessId, data: data as WalletSummary, updatedAt: Date.now() });
      } catch {
        if (!controller.signal.aborted) setBalances({ partnerId: businessId, error: "We cannot load your balances. Please try again." });
      } finally { inFlight = false; }
    }
    void loadBalances();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void loadBalances(); }, 5000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [state, partnerId, refreshRevision, view]);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    setBusy(true); setMessage("");
    try {
      const { response, data } = await walletBrowserRequest("/api/wallet/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: fields.get("email"), password: fields.get("password") }),
      }, 35000);
      if (!response.ok) { setMessage(data.message); return; }
      setState("loading"); setContext(null); setBalances(null); setPartnerId(null);
      setSessionRevision(value => value + 1);
    } catch { setMessage("We could not sign you in. Please try again."); }
    finally {
      const password = form.elements.namedItem("password") as HTMLInputElement | null;
      if (password) password.value = "";
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    try {
      const { response } = await walletBrowserRequest("/api/wallet/logout", { method: "POST" });
      if (!response.ok) throw new Error("Sign-out failed.");
      setContext(null); setPartnerId(null); setBalances(null); setState("signed-out"); setMessage("");
    } catch { setMessage("We could not sign you out. Please try again."); }
    finally { setBusy(false); }
  }

  function refresh() { setBalances(null); setRefreshRevision(value => value + 1); }

  if (state === "loading") return <section className="card wallet-loading" aria-busy="true"><div className="card-body"><span className="spinner-border spinner-border-sm text-primary me-2" aria-hidden="true" /><span role="status">Loading your wallet…</span></div></section>;

  if (state === "signed-out") return (
    <section className="card wallet-signin" aria-labelledby="wallet-signin-title">
      <div className="card-body">
        <div className="wallet-walletIcon"><i className="bx bx-lock-alt" aria-hidden="true" /></div>
        <p className="wallet-eyebrow">Wallet · TZS</p>
        <h2 id="wallet-signin-title" className="h4">Sign in to your wallet</h2>
        <p className="text-muted mb-4">Use your eMakato portal account to view your business balances.</p>
        {message && <p className="alert alert-danger" role="alert">{message}</p>}
        <form onSubmit={signIn}>
          <div className="mb-3"><label className="form-label" htmlFor="wallet-email">Email address</label><input id="wallet-email" name="email" type="email" className="form-control" autoComplete="username" required maxLength={254} disabled={busy} /></div>
          <div className="mb-4"><label className="form-label" htmlFor="wallet-password">Password</label><input id="wallet-password" name="password" type="password" className="form-control" autoComplete="current-password" required maxLength={1024} disabled={busy} /></div>
          <button className="btn btn-primary w-100" disabled={busy} type="submit">{busy ? "Signing in…" : "Sign in"}</button>
        </form>
      </div>
    </section>
  );

  if (state === "error" || state === "blocked") return (
    <section className="card"><div className="card-body"><h2 className="h5">{state === "blocked" ? "Wallet access unavailable" : "Unable to load your wallet"}</h2><p role="alert">{message}</p><div className="d-flex gap-2"><button className="btn btn-primary" onClick={() => { setState("loading"); setSessionRevision(value => value + 1); }}>Try again</button><button className="btn btn-outline-secondary" disabled={busy} onClick={signOut}>Sign out</button></div></div></section>
  );

  const business = context?.businesses.find(business => business.id === partnerId);
  const current = balances?.partnerId === partnerId ? balances : null;
  const summary = current?.data;
  const isEmpty = summary && Object.values(summary.balances).every(value => value === "0");

  return (
    <div className="wallet-overview">
      <div className="card wallet-toolbar"><div className="card-body d-flex align-items-end justify-content-between flex-wrap gap-3">
        <div className="wallet-businessPicker"><label htmlFor="wallet-business" className="form-label">Business</label><select id="wallet-business" className="form-select" value={partnerId ?? ""} onChange={event => { setBalances(null); setPartnerId(Number(event.target.value)); }}>
          {context?.businesses.map(business => <option key={business.id} value={business.id}>{business.name} · {business.reference}</option>)}
        </select></div>
        <div className="d-flex align-items-center gap-3 flex-wrap"><span className="text-muted">{context?.user.name}</span><button className="btn btn-outline-secondary btn-sm" disabled={busy} onClick={signOut}>{busy ? "Signing out…" : "Sign out"}</button></div>
      </div></div>
      {message && <p className="alert alert-danger" role="alert">{message}</p>}
      {view === "collections" && partnerId !== null && <WalletCollectionsView key={partnerId} partnerId={partnerId} />}
      {view === "statement" && partnerId !== null && <WalletStatementView key={partnerId} partnerId={partnerId} />}
      {view === "withdrawals" && partnerId !== null && <WalletBankAccount key={partnerId} partnerId={partnerId} />}
      {view === "withdrawals" && partnerId !== null && <WalletWithdrawalsView key={`withdrawals-${partnerId}`} partnerId={partnerId} />}
      {view === "overview" && <>
      <div className="d-flex align-items-center justify-content-between gap-3 mb-3 flex-wrap"><div><p className="wallet-eyebrow mb-1">Wallet · TZS</p><h2 className="h4 mb-1">Collections wallet</h2><p className="text-muted mb-0">{business?.name}</p></div><button className="btn btn-outline-primary btn-sm" onClick={refresh} disabled={!current}><i className="bx bx-refresh me-1" aria-hidden="true" />Refresh balances</button></div>
      {current?.error ? <div className="alert alert-danger" role="alert"><p className="mb-2">{current.error}</p><button className="btn btn-outline-danger btn-sm" onClick={refresh}>Try again</button></div> : <>
        {summary?.wallet.status === "FROZEN" && <p className="alert alert-warning" role="status">Your wallet is frozen. Outgoing payments are currently unavailable.</p>}
        <section className="card wallet-balanceHero" aria-labelledby="wallet-available-title" aria-busy={!summary}>
          <div className="card-body"><div className="d-flex align-items-start justify-content-between gap-3"><h3 id="wallet-available-title" className="wallet-balanceLabel">Available balance</h3><i className="bx bx-wallet wallet-heroIcon" aria-hidden="true" /></div><p className="wallet-balanceValue" data-testid="wallet-available">{summary ? formatTZS(summary.balances.available) : "—"}</p><p className="wallet-balanceHelp">Money ready to use. Pending bank payments and reserved funds are excluded.</p></div>
        </section>
        <div className="row g-3 mb-3">
          {[
            { key: "clearing" as const, title: "In bank clearing", icon: "bx-time-five", help: "Bank payments waiting for settlement. This money is not yet available." },
            { key: "reserved" as const, title: "Reserved funds", icon: "bx-lock-alt", help: "Money set aside for pending outgoing payments. Already excluded from available balance." },
          ].map(item => <div className="col-md-6" key={item.key}><section className="card wallet-balanceCard h-100 mb-0" aria-busy={!summary}><div className="card-body"><div className="d-flex align-items-center gap-2 mb-3"><i className={`bx ${item.icon}`} aria-hidden="true" /><h3 className="h6 mb-0">{item.title}</h3></div><p className="wallet-secondaryValue" data-testid={`wallet-${item.key}`}>{summary ? formatTZS(summary.balances[item.key]) : "—"}</p><p className="text-muted mb-0">{item.help}</p></div></section></div>)}
        </div>
        {!summary && <p className="text-muted" role="status">Loading balances…</p>}
        {isEmpty && <div className="wallet-notice mb-3"><i className="bx bx-info-circle" aria-hidden="true" /><p className="mb-0">No wallet movements yet. Your balances will update as payments are recorded.</p></div>}
        {current?.updatedAt && <p className="text-muted wallet-updated">Updates automatically · Last checked {new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Dar_es_Salaam", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(current.updatedAt)} EAT</p>}
      </>}
      </>}
      {view === "simulations" && <>
        {context?.simulation_enabled && partnerId !== null && <WalletBankAccount key={`account-${partnerId}`} partnerId={partnerId} practice />}
        {context?.simulation_enabled && partnerId !== null && <WalletWithdrawalSimulator key={`withdrawal-${partnerId}`} partnerId={partnerId} onRecorded={refresh} />}
        {context?.simulation_enabled && partnerId !== null && <WalletWithdrawalsView key={`review-${partnerId}`} partnerId={partnerId} controls refreshToken={refreshRevision} />}
        {!context?.simulation_enabled && <p className="alert alert-info" role="status">Simulations are disabled on this server.</p>}
        {context?.simulation_enabled && partnerId !== null && <WalletCollectionSimulator key={partnerId} partnerId={partnerId} onRecorded={refresh} />}
        {context?.simulation_enabled && partnerId !== null && <WalletBankSettlement key={`bank-${partnerId}`} partnerId={partnerId} onRecorded={refresh} />}
      </>}
    </div>
  );
}
