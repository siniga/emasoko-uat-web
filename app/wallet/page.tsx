

export default function WalletPage() {
  return (
    <div className="sp-list-shell">
      <div className="page-title-box d-sm-flex align-items-center justify-content-between">
        <h1 className="mb-sm-0 font-size-18">Wallet</h1>
        <nav aria-label="Breadcrumb"><ol className="breadcrumb m-0"><li className="breadcrumb-item">eMakato</li><li className="breadcrumb-item active" aria-current="page">Wallet</li></ol></nav>
      </div>
      <section className={`card wallet-welcome`} aria-labelledby="wallet-heading">
        <div className="card-body">
          <div className={"wallet-walletIcon"}><i className="bx bx-wallet" aria-hidden="true" /></div>
          <p className={"wallet-eyebrow"}>Wallet · TZS</p>
          <h2 id="wallet-heading" className="h4 mb-3">Your collections wallet</h2>
          <p className="text-muted mb-4">A single place to view money collected for your business and manage your payments.</p>
          <div className={"wallet-notice"}><i className="bx bx-info-circle" aria-hidden="true" /><p className="mb-0">Your wallet is being prepared. Balances and payment actions will appear here when setup is complete.</p></div>
        </div>
      </section>
    </div>
  );
}
