import type { Metadata } from "next";
import WalletShell from "./wallet-shell";

export const metadata: Metadata = { title: "Wallet" };

export default function WalletLayout({ children }: { children: React.ReactNode }) {
  return <WalletShell>{children}</WalletShell>;
}
