import WalletShell from "../wallet/wallet-shell";

export default function EquityCheckoutLayout({ children }: { children: React.ReactNode }) {
  return <WalletShell activePage="equity-checkout">{children}</WalletShell>;
}
