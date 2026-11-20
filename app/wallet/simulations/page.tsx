import Link from "next/link";
import WalletOverview from "../wallet-overview";

export const metadata = { title: "Wallet simulations" };

export default function WalletSimulationsPage() {
  return <div className="sp-list-shell">
    <div className="page-title-box d-sm-flex align-items-center justify-content-between">
      <h1 className="mb-sm-0 font-size-18">Simulations</h1>
      <nav aria-label="Breadcrumb"><ol className="breadcrumb m-0"><li className="breadcrumb-item"><Link href="/wallet">Wallet</Link></li><li className="breadcrumb-item active" aria-current="page">Simulations</li></ol></nav>
    </div>
    <WalletOverview view="simulations" />
  </div>;
}
