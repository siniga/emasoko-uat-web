import Link from "next/link";

export default function Home() {
  return (
    <main className="container py-5">
      <h1 className="h3">eMakato</h1>
      <p>Manage your collections and payments.</p>
      <div className="d-flex flex-wrap gap-3">
        <Link className="btn btn-primary" href="/wallet">Open Wallet</Link>
        <Link className="btn btn-outline-primary" href="/equity-checkout">Equity Checkout</Link>
      </div>
    </main>
  );
}
