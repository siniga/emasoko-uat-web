"use client";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { WalletBank } from "./wallet-data";
import { walletBrowserRequest } from "./wallet-request";

export default function WalletBankAccount({ partnerId, practice = false }: { partnerId: number; practice?: boolean }) {
  const [loaded, setLoaded] = useState<{ bank: WalletBank | null } | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [challenge, setChallenge] = useState<{ challenge_id: string; demo_code: string; expires_at: string } | null>(null);
  const [revision, setRevision] = useState(0);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  useEffect(() => {
    const controller = new AbortController();
    walletBrowserRequest(`/api/wallet/bank-account?partner_id=${partnerId}`, { signal: controller.signal }).then(({ response, data }) => {
      if (controller.signal.aborted) return;
      if (!response.ok) throw new Error();
      setLoaded(data);
    }).catch(() => { if (!controller.signal.aborted) setMessage("Cannot load the dedicated bank account. Please refresh."); });
    return () => controller.abort();
  }, [partnerId, revision]);

  async function run(action: string, body: object = {}) {
    const controller = new AbortController(); active.current = controller;
    setBusy(true); setMessage("");
    try {
      const { response, data } = await walletBrowserRequest(`/api/wallet/${action}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, partner_id: partnerId }), signal: controller.signal,
      }, 35000);
      if (controller.signal.aborted) return;
      if (!response.ok) { setMessage(data.message); return; }
      if (action === "simulate-bank-account") { setLoaded(data); setMessage("Dedicated test account created. This is a simulation of Operations verification."); }
      if (action === "otp-request") { setChallenge(data); setMessage("Test code generated. No SMS was sent. It expires in five minutes."); }
      if (action === "otp-verify") { setChallenge(null); setMessage("OTP practice passed. The code is now used. No withdrawal was requested."); }
    } catch { if (!controller.signal.aborted) setMessage("Cannot confirm the result. Refresh the account, or request a new OTP after 30 seconds."); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget; const code = String(new FormData(form).get("code") ?? "");
    if (challenge) void run("otp-verify", { challenge_id: challenge.challenge_id, code });
    form.reset();
  }
  return <section className="card"><div className="card-body">
    <h2 className="h5">{practice ? "Test bank account and OTP" : "Dedicated withdrawal account"}</h2>
    {practice && <p className="alert alert-warning">Simulation only. Use the dummy account below to practise the safeguards. No bank verification or SMS service is contacted.</p>}
    {!loaded && <p role="status">Loading bank account…</p>}
    {loaded?.bank ? <><dl className="row"><dt className="col-sm-4">Bank</dt><dd className="col-sm-8">{loaded.bank.bank_name}</dd><dt className="col-sm-4">Account name</dt><dd className="col-sm-8">{loaded.bank.account_name}</dd><dt className="col-sm-4">Account number</dt><dd className="col-sm-8">{loaded.bank.masked_number}</dd><dt className="col-sm-4">Verification</dt><dd className="col-sm-8">{loaded.bank.is_simulated ? "Test verification (simulation)" : "Verified by Operations"}</dd></dl><p className="text-muted">Withdrawals will use this dedicated account. Replacement requires Operations verification and a signed letter.</p></> : loaded && <p>No verified dedicated account is set. Operations must verify a live account before withdrawals can be enabled.</p>}
    {message && <p className="alert alert-info" role="status">{message}</p>}
    <div className="d-flex gap-2 flex-wrap mb-3"><button className="btn btn-outline-secondary btn-sm" disabled={busy} onClick={() => { setLoaded(null); setMessage(""); setRevision(value => value + 1); }}>Refresh account</button>
      {practice && loaded && !loaded.bank && <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => run("simulate-bank-account", { bank_name: "Test Bank", account_name: "Learning account", account_number: "000000001234" })}>Create dedicated test account</button>}
      {practice && loaded?.bank?.is_simulated && <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => run("otp-request")}>Request test OTP</button>}
    </div>
    {practice && challenge && <form onSubmit={verify}><p>Demo code: <strong>{challenge.demo_code}</strong> · Valid for five minutes from issue. A new code replaces the previous one.</p><label className="form-label" htmlFor="wallet-test-otp">Enter the six-digit test code</label><input id="wallet-test-otp" name="code" className="form-control mb-3" style={{ maxWidth: 220 }} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required disabled={busy} /><button type="submit" className="btn btn-primary" disabled={busy}>Verify test OTP</button></form>}
  </div></section>;
}
