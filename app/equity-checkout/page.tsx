import type { Metadata } from "next";
import EquityCheckout from "./checkout";
import "./checkout.css";

export const metadata: Metadata = {
  title: "Equity Checkout",
  description: "Pay with your card through eMakato Equity Checkout.",
};

export default function EquityCheckoutPage() {
  return <EquityCheckout />;
}
