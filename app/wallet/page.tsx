import WalletOverview from "./wallet-overview";
export default function WalletPage() {
  return (
    <div className="sp-list-shell">
      <div className="page-title-box d-sm-flex align-items-center justify-content-between">
        <h1 className="mb-sm-0 font-size-18">Wallet</h1>
        <nav aria-label="Breadcrumb"><ol className="breadcrumb m-0"><li className="breadcrumb-item">eMakato</li><li className="breadcrumb-item active" aria-current="page">Wallet</li></ol></nav>
      </div>
      <WalletOverview />
    </div>
  );
}
