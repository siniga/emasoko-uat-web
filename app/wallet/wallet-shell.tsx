"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import "./wallet.css";

// React equivalent of the portal's master, topbar, sidebar and footer Blade layouts.
export default function WalletShell({ children, activePage = "wallet" }: { children: React.ReactNode; activePage?: "wallet" | "equity-checkout" }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [expandedGroup, setExpandedGroup] = useState<"wallet" | "checkout" | null>(activePage === "wallet" ? "wallet" : "checkout");
  const pathname = usePathname();

  function toggleGroup(group: "wallet" | "checkout") {
    setExpandedGroup(current => current === group ? null : group);
  }

  return (
    <div className={`wallet-shell ${menuOpen ? "wallet-menuOpen" : ""}`}>
      <a href="#wallet-content" className={"wallet-skipLink"}>Skip to content</a>
      <header id="page-topbar" className={"wallet-header"}>
        <div className="navbar-header">
          <div className="d-flex">
            <div className={`navbar-brand-box wallet-brand`}>
              <Link href="/wallet" aria-label="eMakato Wallet">
                <Image src="/portal-assets/images/emakato_logo_white.png" alt="eMakato" width={148} height={32} unoptimized className={"wallet-logo"} />
              </Link>
            </div>
            <button type="button" className={`btn header-item wallet-menuButton`} aria-label={menuOpen ? "Close navigation" : "Open navigation"} aria-expanded={menuOpen} aria-controls="wallet-navigation" onClick={() => setMenuOpen(!menuOpen)}>
              <i className="bx bx-menu" aria-hidden="true" />
            </button>
            <span className={"wallet-headerTitle"}>Subscriber portal</span>
          </div>
          <span className={"wallet-preview"}>{activePage === "wallet" ? "Wallet preview" : "Equity Checkout"}</span>
        </div>
      </header>

      {menuOpen && <button type="button" className={"wallet-backdrop"} aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
      <aside id="wallet-navigation" className={`vertical-menu wallet-sidebar`} onKeyDown={(event) => { if (event.key === "Escape") setMenuOpen(false); }}>
        <nav id="sidebar-menu" aria-label="Subscriber navigation">
          <ul className="list-unstyled" id="side-menu">
            <li className={expandedGroup === "wallet" ? "wallet-navGroup is-open" : "wallet-navGroup"}>
              <button type="button" className="wallet-groupToggle" aria-expanded={expandedGroup === "wallet"} aria-controls="wallet-submenu" onClick={() => toggleGroup("wallet")}>
                <i className="bx bx-wallet" aria-hidden="true" /><span>Wallet</span><i className="bx bx-chevron-down wallet-groupChevron" aria-hidden="true" />
              </button>
              <ul id="wallet-submenu" className="list-unstyled sub-menu wallet-submenu" hidden={expandedGroup !== "wallet"}>
                {[
                  { label: "Collections", href: "/wallet/collections", icon: "bx-transfer-alt" },
                  { label: "Withdrawals", href: "/wallet/withdrawals", icon: "bx-building-house" },
                  { label: "Disbursements", href: "/wallet/disbursements", icon: "bx-mobile-alt" },
                ].map(({ label, href, icon }) => (
                  <li key={href}>
                    <Link href={href} className={pathname === href ? "wallet-submenuActive" : ""} aria-current={pathname === href ? "page" : undefined} onClick={() => setMenuOpen(false)}><i className={`bx ${icon}`} aria-hidden="true" /><span>{label}</span></Link>
                  </li>
                ))}
              </ul>
            </li>
            <li className={expandedGroup === "checkout" ? "wallet-navGroup is-open" : "wallet-navGroup"}>
              <button type="button" className="wallet-groupToggle" aria-expanded={expandedGroup === "checkout"} aria-controls="checkout-submenu" onClick={() => toggleGroup("checkout")}>
                <i className="bx bx-credit-card" aria-hidden="true" /><span>Checkout</span><i className="bx bx-chevron-down wallet-groupChevron" aria-hidden="true" />
              </button>
              <ul id="checkout-submenu" className="list-unstyled sub-menu wallet-submenu" hidden={expandedGroup !== "checkout"}>
                <li><Link href="/equity-checkout" className={activePage === "equity-checkout" ? "wallet-submenuActive" : ""} aria-current={activePage === "equity-checkout" ? "page" : undefined} onClick={() => setMenuOpen(false)}><i className="bx bx-credit-card-front" aria-hidden="true" /><span>Equity</span></Link></li>
              </ul>
            </li>
          </ul>
        </nav>
      </aside>

      <div className={`main-content wallet-main`}>
        <main id="wallet-content" tabIndex={-1} className="page-content">
          <div className="container-fluid">{children}</div>
        </main>
        <footer className={`footer wallet-footer`}>
          <div className="container-fluid d-flex justify-content-between flex-wrap gap-2">
            <span>© eMakato. All rights reserved.</span>
            <span>Product of SoloCodes</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
