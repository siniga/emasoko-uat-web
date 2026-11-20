import assert from "node:assert/strict";
import test from "node:test";
import { readWithdrawal, readWithdrawalQuote, formatTZS, readSimulatedCollection, readWalletContext, readWalletSummary, wholeShillings } from "../app/wallet/wallet-data.ts";

const summary = () => ({ success: true, data: {
  wallet: { id: "wallet-1", partner_id: 1, currency: "TZS", status: "ACTIVE" },
  balances: { available: 100000, clearing: 200000, reserved: 30000 },
} });

test("withdrawal quotes validate charge arithmetic and masked destinations", () => {
  const quote = { amount: "50000", fee: "2500", net_amount: "47500", bank_name: "Test Bank", masked_number: "****1234",
    challenge_id: "test", demo_code: "123456", expires_at: "2026-11-15T20:00:00Z" };
  assert.equal(readWithdrawalQuote(quote).net_amount, "47500");
  assert.throws(() => readWithdrawalQuote({ ...quote, net_amount: "50000" }));
  assert.throws(() => readWithdrawalQuote({ ...quote, masked_number: "000000001234" }));
  assert.throws(() => readWithdrawalQuote({ ...quote, demo_code: "123" }));
  assert.throws(() => readWithdrawalQuote({ ...quote, amount: Number.MAX_SAFE_INTEGER + 1 }));
});

test("withdrawal history strips private fields and rejects unknown statuses", () => {
  const item = { amount: "50000", fee: "2500", net_amount: "47500", bank_name: "Test", masked_number: "****1234",
    id: "id", reference: "EMK-W-TEST", status: "AWAITING_APPROVAL", is_simulated: true, requested_at: "2026-11-15T20:00:00Z", payload_hash: "private" };
  assert.equal(readWithdrawal(item).payload_hash, undefined);
  assert.throws(() => readWithdrawal({ ...item, status: "UNKNOWN" }));
});

test("whole-shilling formatting is exact and never adds decimals", () => {
  assert.equal(formatTZS("0"), "TZS 0");
  assert.equal(formatTZS("6561367"), "TZS 6,561,367");
  assert.equal(formatTZS("9007199254740993"), "TZS 9,007,199,254,740,993");
});

test("invalid and already-rounded numeric balances are rejected", () => {
  for (const value of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, null, "1.5", "-1", "1,000", "", "01"]) {
    assert.throws(() => wholeShillings(value));
  }
});

test("all three balances are displayed independently, without subtracting reserved twice", () => {
  assert.deepEqual(readWalletSummary(summary(), 1).balances, { available: "100000", clearing: "200000", reserved: "30000" });
});

test("missing balances are errors, not zero balances", () => {
  const payload = summary();
  delete payload.data.balances.available;
  assert.throws(() => readWalletSummary(payload, 1));
});

test("unexpected business and currency are rejected", () => {
  assert.throws(() => readWalletSummary(summary(), 2));
  const payload = summary();
  payload.data.wallet.currency = "USD";
  assert.throws(() => readWalletSummary(payload, 1));
});

test("frozen wallets are supported", () => {
  const payload = summary();
  payload.data.wallet.status = "FROZEN";
  assert.equal(readWalletSummary(payload, 1).wallet.status, "FROZEN");
});

test("only approved context fields reach the browser", () => {
  const result = readWalletContext({ success: true, data: {
    user: { id: 1, name: "Test user", password: "never-return-this" }, token: "never-return-this",
    businesses: [{ id: 1, name: "Test business", reference: "CO-1", account_number: "never-return-this" }],
  } });
  assert.deepEqual(result, { user: { id: 1, name: "Test user" }, businesses: [{ id: 1, name: "Test business", reference: "CO-1" }] });
});

test("an empty or malformed authorised-business list is rejected", () => {
  assert.throws(() => readWalletContext({ success: true, data: { user: { id: 1, name: "Test user" }, businesses: [] } }));
  assert.throws(() => readWalletContext({ success: false }));
});

test("simulation requires an explicit backend capability", () => {
  const data = { user: { id: 1, name: "Learner" }, businesses: [{ id: 1, name: "Test", reference: "TEST" }], simulation_enabled: true };
  assert.equal(readWalletContext({ success: true, data }).simulation_enabled, true);
  data.simulation_enabled = "true";
  assert.equal(readWalletContext({ success: true, data }).simulation_enabled, undefined);
});

test("simulation responses are validated and sensitive fields removed", () => {
  const collection = { id: "test", reference: "EMK-C-TEST", payer_name: "Test Customer", provider_name: "M-Pesa", amount: 50000, status: "COMPLETED", is_simulated: true, payload_hash: "private" };
  const parse = () => readSimulatedCollection({ success: true, data: { collection } });
  assert.equal(parse().amount, "50000");
  assert.equal(parse().payload_hash, undefined);
  collection.status = "FAILED";
  assert.throws(parse);
  collection.failure_reason = "Customer PIN timeout";
  assert.equal(parse().failure_reason, "Customer PIN timeout");
  collection.is_simulated = false;
  assert.throws(parse);
});
