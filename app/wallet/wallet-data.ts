export type WalletContext = {
  simulation_enabled?: boolean;
  user: { id: number; name: string };
  businesses: { id: number; name: string; reference: string }[];
};

export type WalletBank = { id: string; bank_name: string; account_name: string; masked_number: string; is_simulated: boolean; verified_at: string };

export type WithdrawalAmounts = { amount: string; fee: string; net_amount: string; bank_name: string; masked_number: string };
export type WalletWithdrawal = WithdrawalAmounts & { id: string; reference: string; status: string; is_simulated: boolean; requested_at: string; requested_by?: number; checked_by?: number | null; decision_reason?: string | null; failure_reason?: string | null };
export type WithdrawalQuote = WithdrawalAmounts & { challenge_id: string; demo_code: string; expires_at: string };
export type WalletWithdrawals = { items: WalletWithdrawal[]; page: number; total: number; last_page: number; can_check: boolean; actor_id: number };
function withdrawalAmounts(value: unknown): WithdrawalAmounts {
  const data = record(value);
  const amount = wholeShillings(data.amount), fee = wholeShillings(data.fee), net = wholeShillings(data.net_amount);
  if (BigInt(fee) + BigInt(net) !== BigInt(amount) || BigInt(net) <= BigInt(0)
    || typeof data.masked_number !== "string" || !/^\*{4}\d{4}$/.test(data.masked_number)) throw new Error("Invalid withdrawal amounts.");
  return { amount, fee, net_amount: net, bank_name: text(data.bank_name), masked_number: data.masked_number };
}
export function readWithdrawal(value: unknown): WalletWithdrawal {
  const data = record(value);
  if (!["AWAITING_APPROVAL", "APPROVED", "PROCESSING", "SETTLED", "REJECTED", "FAILED"].includes(String(data.status))
    || typeof data.is_simulated !== "boolean" || typeof data.requested_at !== "string" || !Number.isFinite(Date.parse(data.requested_at))) throw new Error("Invalid withdrawal.");
  return { ...withdrawalAmounts(data), id: text(data.id), reference: text(data.reference), status: String(data.status), is_simulated: data.is_simulated, requested_at: data.requested_at,
    ...(data.requested_by === undefined ? {} : { requested_by: identifier(data.requested_by), checked_by: data.checked_by === null ? null : identifier(data.checked_by),
      decision_reason: data.decision_reason === null ? null : text(data.decision_reason), failure_reason: data.failure_reason === null ? null : text(data.failure_reason) }) };
}
export function readWithdrawalQuote(value: unknown): WithdrawalQuote {
  const data = record(value);
  if (typeof data.demo_code !== "string" || !/^\d{6}$/.test(data.demo_code) || typeof data.expires_at !== "string" || !Number.isFinite(Date.parse(data.expires_at))) throw new Error("Invalid withdrawal code.");
  return { ...withdrawalAmounts(data), challenge_id: text(data.challenge_id), demo_code: data.demo_code, expires_at: data.expires_at };
}
export function readWithdrawals(value: unknown): WalletWithdrawals {
  const data = record(value);
  if (!Array.isArray(data.items) || data.items.length > 20 || !Number.isSafeInteger(data.total) || Number(data.total) < 0) throw new Error("Invalid withdrawal history.");
  return { items: data.items.map(readWithdrawal), page: identifier(data.page), total: Number(data.total), last_page: identifier(data.last_page),
    can_check: data.can_check === true, actor_id: data.actor_id === undefined ? 0 : identifier(data.actor_id) };
}
export function readBank(value: unknown): WalletBank | null {
  if (value === null) return null;
  const bank = record(value);
  if (typeof bank.is_simulated !== "boolean" || typeof bank.masked_number !== "string" || !/^\*{4}\d{4}$/.test(bank.masked_number)) throw new Error("Invalid bank account.");
  return { id: text(bank.id), bank_name: text(bank.bank_name), account_name: text(bank.account_name),
    masked_number: bank.masked_number, is_simulated: bank.is_simulated, verified_at: text(bank.verified_at) };
}

export type WalletSummary = {
  wallet: { id: string; partner_id: number; currency: "TZS"; status: "ACTIVE" | "FROZEN" };
  balances: { available: string; clearing: string; reserved: string };
};

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Invalid wallet response.");
  return value as Record<string, unknown>;
}

function identifier(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) throw new Error("Invalid business identifier.");
  return value;
}

function text(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error("Missing wallet details.");
  return value;
}

export function wholeShillings(value: unknown): string {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  if (typeof value === "string" && /^(0|[1-9]\d{0,18})$/.test(value)) return value;
  throw new Error("Invalid whole-shilling balance.");
}

export function formatTZS(value: string): string {
  return `TZS ${new Intl.NumberFormat("en-TZ", { maximumFractionDigits: 0 }).format(BigInt(wholeShillings(value)))}`;
}

// Explicitly select browser-safe fields; never pass the raw portal response through.
export function readWalletContext(value: unknown): WalletContext {
  const payload = record(value);
  if (payload.success !== true) throw new Error("Wallet context was not successful.");
  const data = record(payload.data);
  const user = record(data.user);
  if (!Array.isArray(data.businesses) || data.businesses.length === 0) throw new Error("No authorised business.");
  return {
    ...(data.simulation_enabled === true ? { simulation_enabled: true } : {}),
    user: { id: identifier(user.id), name: text(user.name) },
    businesses: data.businesses.map(value => {
      const business = record(value);
      return { id: identifier(business.id), name: text(business.name), reference: text(business.reference) };
    }),
  };
}

export type SimulatedCollection = {
  id: string; reference: string; payer_name: string; provider_name: string;
  amount: string; status: "COMPLETED" | "FAILED" | "CLEARING"; failure_reason: string | null;
};

export function readSimulatedCollection(value: unknown): SimulatedCollection {
  const payload = record(value);
  if (payload.success !== true) throw new Error("Payment was not recorded.");
  const collection = record(record(payload.data).collection);
  if (collection.is_simulated !== true || !["COMPLETED", "FAILED", "CLEARING"].includes(String(collection.status))) {
    throw new Error("Invalid simulated payment.");
  }
  return {
    id: text(collection.id), reference: text(collection.reference), payer_name: text(collection.payer_name),
    provider_name: text(collection.provider_name), amount: wholeShillings(collection.amount),
    status: collection.status as SimulatedCollection["status"],
    failure_reason: collection.status === "FAILED" ? text(collection.failure_reason) : null,
  };
}

export function readWalletSummary(value: unknown, businessId: number): WalletSummary {
  const payload = record(value);
  if (payload.success !== true) throw new Error("Wallet summary was not successful.");
  const data = record(payload.data);
  const wallet = record(data.wallet);
  const balances = record(data.balances);
  if (identifier(wallet.partner_id) !== businessId || wallet.currency !== "TZS"
    || (wallet.status !== "ACTIVE" && wallet.status !== "FROZEN")) throw new Error("Wallet details do not match the selected business.");
  return {
    wallet: { id: text(wallet.id), partner_id: businessId, currency: "TZS", status: wallet.status },
    balances: {
      available: wholeShillings(balances.available),
      clearing: wholeShillings(balances.clearing),
      reserved: wholeShillings(balances.reserved),
    },
  };
}

export type WalletCollection = SimulatedCollection & {
  channel_type: "MNO" | "BANK"; is_simulated: boolean; attempted_at: string; collected_at: string | null;
};
export type WalletCollections = { items: WalletCollection[]; page: number; total: number; last_page: number };

export type WalletStatement = {
  items: { id: string; reference_type: string; reference: string; reversal: boolean; posted_at: string;
    changes: WalletSummary["balances"]; balances: WalletSummary["balances"] }[];
  page: number; total: number; last_page: number; anchor: string;
};
export function readStatement(value: unknown): WalletStatement {
  const payload = record(value); const data = record(payload.data);
  if (payload.success !== true || !Array.isArray(data.items) || data.items.length > 20
    || !Number.isSafeInteger(data.total) || Number(data.total) < 0) throw new Error("Invalid statement.");
  return { page: identifier(data.page), total: Number(data.total), last_page: identifier(data.last_page), anchor: wholeShillings(data.anchor),
    items: data.items.map(value => {
      const row = record(value); const changes = record(row.changes); const balances = record(row.balances);
      const signed = (value: unknown) => {
        if (typeof value !== "string" || !/^(0|-?[1-9]\d{0,18})$/.test(value)) throw new Error("Invalid statement amount.");
        return value;
      };
      if (typeof row.reversal !== "boolean" || typeof row.posted_at !== "string" || !Number.isFinite(Date.parse(row.posted_at))) throw new Error("Invalid statement details.");
      return { id: text(row.id), reference_type: text(row.reference_type), reference: text(row.reference), reversal: row.reversal, posted_at: row.posted_at,
        changes: { available: signed(changes.available), clearing: signed(changes.clearing), reserved: signed(changes.reserved) },
        balances: { available: wholeShillings(balances.available), clearing: wholeShillings(balances.clearing), reserved: wholeShillings(balances.reserved) } };
    }),
  };
}

export function readCollection(value: unknown): WalletCollection {
  const item = record(value);
  if (!["COMPLETED", "CLEARING", "FAILED"].includes(String(item.status))
    || !["MNO", "BANK"].includes(String(item.channel_type)) || typeof item.is_simulated !== "boolean") throw new Error("Invalid collection.");
  function timestamp(value: unknown) {
    const result = text(value);
    if (!/^\d{4}-\d{2}-\d{2}T/.test(result) || !Number.isFinite(Date.parse(result))) throw new Error("Invalid payment date.");
    return result;
  }
  return {
    id: text(item.id), reference: text(item.reference), payer_name: text(item.payer_name),
    provider_name: text(item.provider_name), amount: wholeShillings(item.amount),
    status: item.status as WalletCollection["status"], channel_type: item.channel_type as WalletCollection["channel_type"],
    failure_reason: item.failure_reason === null ? null : text(item.failure_reason), is_simulated: item.is_simulated,
    attempted_at: timestamp(item.attempted_at), collected_at: item.collected_at === null ? null : timestamp(item.collected_at),
  };
}

export function readCollections(value: unknown): WalletCollections {
  const payload = record(value);
  if (payload.success !== true) throw new Error("Cannot read payments.");
  const data = record(payload.data);
  if (!Array.isArray(data.items) || data.items.length > 20 || !Number.isSafeInteger(data.total) || Number(data.total) < 0) throw new Error("Invalid payments page.");
  return { items: data.items.map(readCollection), page: identifier(data.page), total: Number(data.total), last_page: identifier(data.last_page) };
}
