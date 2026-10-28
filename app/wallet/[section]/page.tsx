import Link from "next/link";
import { notFound } from "next/navigation";

const sections = {
  collections: { title: "Collections", icon: "bx-transfer-alt", description: "View and manage payments collected for your business." },
  withdrawals: { title: "Withdrawals", icon: "bx-building-house", description: "Manage withdrawals from your business wallet." },
  disbursements: { title: "Disbursements", icon: "bx-mobile-alt", description: "Manage outgoing payments from your business wallet." },
};

export function generateStaticParams() {
  return Object.keys(sections).map(section => ({ section }));
}

export default async function WalletSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const details = sections[section as keyof typeof sections];
  if (!Object.hasOwn(sections, section)) notFound();

  return (
    <div className="sp-list-shell">
      <div className="page-title-box d-sm-flex align-items-center justify-content-between">
        <h1 className="mb-sm-0 font-size-18">{details.title}</h1>
        <nav aria-label="Breadcrumb"><ol className="breadcrumb m-0"><li className="breadcrumb-item"><Link href="/wallet">Wallet</Link></li><li className="breadcrumb-item active" aria-current="page">{details.title}</li></ol></nav>
      </div>
      <section className="card wallet-welcome" aria-labelledby="wallet-section-heading">
        <div className="card-body">
          <div className="wallet-walletIcon"><i className={`bx ${details.icon}`} aria-hidden="true" /></div>
          <p className="wallet-eyebrow">Wallet · TZS</p>
          <h2 id="wallet-section-heading" className="h4 mb-3">{details.title}</h2>
          <p className="text-muted mb-4">{details.description}</p>
          <div className="wallet-notice"><i className="bx bx-info-circle" aria-hidden="true" /><p className="mb-0">This section is being prepared. {details.title} will appear here when setup is complete.</p></div>
        </div>
      </section>
    </div>
  );
}
