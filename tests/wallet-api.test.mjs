import assert from "node:assert/strict";
import test from "node:test";

// Run only against a Next server connected to the disposable Laravel fixture.
const base = process.env.WALLET_TEST_URL ?? "http://127.0.0.1:3100";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname), "Use a local test server.");
let cookie = "";
async function request(path, { method = "GET", body, authenticated = true, origin = true, key } = {}) {
  return fetch(`${base}/api/wallet/${path}`, {
    method, headers: { ...(authenticated && cookie ? { Cookie: cookie } : {}),
      ...(method === "POST" && origin ? { Origin: new URL(base).origin } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}), ...(key ? { "Idempotency-Key": key } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000),
  });
}

test("Wallet browser API with real Laravel authentication and disposable data", async t => {
  await t.test("guests cannot read balances", async () => {
    const response = await request("summary?partner_id=1");
    assert.equal(response.status, 401);
    assert.match(response.headers.get("cache-control"), /no-store/);
  });
  await t.test("sign-in rejects cross-site or missing-origin requests", async () => {
    const response = await request("login", { method: "POST", origin: false, body: { email: "learner@example.test", password: "Wallet-test-only-2026!" } });
    assert.equal(response.status, 403);
  });
  await t.test("incorrect credentials do not issue a cookie", async () => {
    const response = await request("login", { method: "POST", body: { email: "learner@example.test", password: "incorrect-test-password" } });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("set-cookie"), null);
  });
  await t.test("sign-in uses an HTTP-only cookie without returning the token", async () => {
    const response = await request("login", { method: "POST", body: { email: "learner@example.test", password: "Wallet-test-only-2026!" } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true });
    const header = response.headers.get("set-cookie");
    assert.match(header, /HttpOnly/i);
    assert.match(header, /SameSite=strict/i);
    assert.match(header, /Path=\/api\/wallet/i);
    assert.match(header, /Max-Age=900/i);
    cookie = header.split(";")[0];
  });
  await t.test("only the user's authorised businesses are returned", async () => {
    const response = await request("context");
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.deepEqual(data.businesses.map(b => b.id), [1, 2]);
    assert.deepEqual(Object.keys(data.user).sort(), ["id", "name"]);
    assert.equal(data.token, undefined);
  });
  await t.test("available, clearing and reserved are fetched from the ledger", async () => {
    const response = await request("summary?partner_id=1");
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).balances, { available: "100000", clearing: "200000", reserved: "30000" });
  });
  await t.test("another authorised business gets its own zero balances", async () => {
    const response = await request("summary?partner_id=2");
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).balances, { available: "0", clearing: "0", reserved: "0" });
  });
  await t.test("other businesses and invalid identifiers are rejected", async () => {
    assert.equal((await request("summary?partner_id=3")).status, 403);
    assert.equal((await request("summary?partner_id=invalid")).status, 400);
    assert.equal((await request("journals", { method: "POST", body: {} })).status, 404);
  });
  await t.test("simulated collections credit once, record failures and enforce access", async () => {
    const body = { partner_id: 1, payer_name: "Test Customer", amount: "25000", provider_code: "MPESA", result: "COMPLETED" };
    const key = crypto.randomUUID();
    const send = (payload = body, requestKey = key) => request("simulate-collection", { method: "POST", body: payload, key: requestKey });
    assert.equal((await request("context").then(r => r.json())).simulation_enabled, true);
    assert.equal((await request("simulate-collection", { method: "POST", body })).status, 422);
    assert.equal((await request("simulate-collection", { method: "POST", body, key, origin: false })).status, 403);
    const first = await send();
    assert.equal(first.status, 201);
    const collection = (await first.json()).collection;
    assert.equal(collection.status, "COMPLETED");
    assert.equal(collection.amount, "25000");
    const repeated = await send();
    assert.equal(repeated.status, 200);
    assert.equal((await repeated.json()).collection.id, collection.id);
    assert.equal((await send({ ...body, amount: "26000" })).status, 409);
    assert.equal((await send({ ...body, partner_id: 3 }, crypto.randomUUID())).status, 403);
    const failed = await send({ ...body, result: "FAILED", failure_code: "PIN_TIMEOUT" }, crypto.randomUUID());
    assert.equal(failed.status, 201);
    assert.equal((await failed.json()).collection.failure_reason, "Customer PIN timeout");
    assert.deepEqual((await request("summary?partner_id=1").then(r => r.json())).balances, { available: "125000", clearing: "200000", reserved: "30000" });
    assert.equal((await request("summary?partner_id=2").then(r => r.json())).balances.available, "0");
  });
  await t.test("bank clearing and settlement move funds once through the browser API", async () => {
    const response = await request("simulate-collection", { method: "POST", key: crypto.randomUUID(), body: {
      partner_id: 1, payer_name: "Bank learner", amount: "40000", provider_code: "BANK_SIM", result: "COMPLETED",
    } });
    assert.equal(response.status, 201);
    const collection = (await response.json()).collection;
    assert.equal(collection.status, "CLEARING");
    const summary = () => request("summary?partner_id=1").then(r => r.json());
    assert.deepEqual((await summary()).balances, { available: "125000", clearing: "240000", reserved: "30000" });
    const pending = await request("pending-banks?partner_id=1").then(r => r.json());
    assert.equal(pending.items[0].id, collection.id);
    const body = { partner_id: 1, collection_id: collection.id };
    assert.equal((await request("settle-bank", { method: "POST", body, origin: false })).status, 403);
    for (let i = 0; i < 2; i++) assert.equal((await request("settle-bank", { method: "POST", body })).status, 200);
    assert.deepEqual((await summary()).balances, { available: "165000", clearing: "200000", reserved: "30000" });
    assert.equal((await request("pending-banks?partner_id=1").then(r => r.json())).items.length, 0);
  });
  await t.test("collections list, filters and details are safe and isolated", async () => {
    const response = await request("collections?partner_id=1");
    assert.equal(response.status, 200);
    const list = await response.json();
    assert.equal(list.total, 3);
    assert.equal(list.items.length, 3);
    assert.equal(list.items[0].is_simulated, true);
    assert.equal(list.items[0].payload_hash, undefined);
    assert.equal(list.items[0].idempotency_key, undefined);
    assert.equal((await request("collections?partner_id=1&status=FAILED").then(r => r.json())).total, 1);
    assert.equal((await request("collections?partner_id=1&channel=BANK").then(r => r.json())).total, 1);
    const id = list.items[0].id;
    const detail = await request(`collections?partner_id=1&collection_id=${id}`);
    assert.equal(detail.status, 200);
    assert.equal((await detail.json()).collection.id, id);
    assert.equal((await request(`collections?partner_id=2&collection_id=${id}`)).status, 404);
    assert.equal((await request("collections?partner_id=3")).status, 403);
    assert.equal((await request("collections?partner_id=1&status=INVALID")).status, 422);
  });
  await t.test("statement balances match ledger movements without duplicating settlement money", async () => {
    const response = await request("statement?partner_id=1");
    assert.equal(response.status, 200);
    const statement = await response.json();
    assert.equal(statement.total, 6);
    assert.equal(statement.items[0].balances.available, "130000");
    const last = statement.items.at(-1);
    assert.deepEqual(last.changes, { available: "40000", clearing: "-40000", reserved: "0" });
    assert.deepEqual(last.balances, { available: "165000", clearing: "200000", reserved: "30000" });
    assert.equal((await request("statement?partner_id=2").then(r => r.json())).total, 0);
    assert.equal((await request("statement?partner_id=3")).status, 403);
    assert.equal((await request(`statement?partner_id=1&anchor=${statement.anchor}`).then(r => r.json())).total, 6);
  });
  await t.test("dedicated test account and OTP practice are masked, scoped and single-use", async () => {
    assert.equal((await request("bank-account?partner_id=1").then(r => r.json())).bank, null);
    const body = { partner_id: 1, bank_name: "Test Bank", account_name: "Test School", account_number: "000000001234" };
    const setup = await request("simulate-bank-account", { method: "POST", body });
    assert.equal(setup.status, 201);
    const bank = (await setup.json()).bank;
    assert.equal(bank.masked_number, "****1234");
    assert.equal(bank.account_number_encrypted, undefined);
    assert.equal(bank.details_hash, undefined);
    assert.equal((await request("simulate-bank-account", { method: "POST", body: { ...body, account_number: "11111111" } })).status, 409);
    const issue = await request("otp-request", { method: "POST", body: { partner_id: 1 } });
    assert.equal(issue.status, 201);
    const otp = await issue.json();
    assert.match(otp.demo_code, /^[0-9]{6}$/);
    const verify = { partner_id: 1, challenge_id: otp.challenge_id, code: otp.demo_code };
    assert.equal((await request("otp-verify", { method: "POST", body: verify, origin: false })).status, 403);
    assert.equal((await request("otp-verify", { method: "POST", body: { ...verify, code: "000000" } })).status, 422);
    assert.equal((await request("otp-verify", { method: "POST", body: verify })).status, 200);
    assert.equal((await request("otp-verify", { method: "POST", body: verify })).status, 409);
    assert.equal((await request("bank-account?partner_id=2").then(r => r.json())).bank, null);
    assert.equal((await request("bank-account?partner_id=3")).status, 403);
  });
  await t.test("withdrawal OTP confirms exact details and reserves funds once", async () => {
    const key = crypto.randomUUID();
    const partner_id = 2;
    const setup = await request("simulate-bank-account", { method: "POST", body: { partner_id, bank_name: "Test Bank", account_name: "Test business", account_number: "000000001234" } });
    assert.equal(setup.status, 201);
    const funded = await request("simulate-collection", { method: "POST", key: crypto.randomUUID(), body: { partner_id, payer_name: "Withdrawal fixture", provider_code: "MPESA", amount: "100000", result: "COMPLETED" } });
    assert.equal(funded.status, 201);
    const issue = await request("withdrawal-otp", { method: "POST", key, body: { partner_id, amount: "50000" } });
    assert.equal(issue.status, 201);
    const otp = await issue.json();
    assert.equal(otp.net_amount, "47500");
    const body = { partner_id, amount: "50000", challenge_id: otp.challenge_id, code: otp.demo_code };
    assert.equal((await request("withdrawals", { method: "POST", key, body, origin: false })).status, 403);
    assert.equal((await request("withdrawals", { method: "POST", key, body: { ...body, code: "000000" } })).status, 422);
    const first = await request("withdrawals", { method: "POST", key, body });
    assert.equal(first.status, 201);
    const withdrawal = (await first.json()).withdrawal;
    assert.equal(withdrawal.status, "AWAITING_APPROVAL");
    const replay = await request("withdrawals", { method: "POST", key, body });
    assert.equal(replay.status, 200);
    assert.equal((await replay.json()).withdrawal.id, withdrawal.id);
    assert.equal((await request("withdrawals", { method: "POST", key, body: { ...body, amount: "60000" } })).status, 409);
    const history = await request("withdrawals?partner_id=2").then(r => r.json());
    assert.equal(history.total, 1);
    assert.equal(history.items[0].payload_hash, undefined);
    assert.equal(history.items[0].masked_number, "****1234");
    assert.equal((await request("withdrawals?partner_id=1").then(r => r.json())).total, 0);
    assert.equal((await request("withdrawals?partner_id=3")).status, 403);
    assert.deepEqual((await request("summary?partner_id=2").then(r => r.json())).balances, { available: "50000", clearing: "0", reserved: "50000" });
    const statement = await request("statement?partner_id=2").then(r => r.json());
    assert.deepEqual(statement.items.at(-1).changes, { available: "-50000", clearing: "0", reserved: "50000" });
  });
  await t.test("a different assigned checker approves and settles once", async () => {
    const makerCookie = cookie;
    const list = await request("withdrawals?partner_id=2").then(r => r.json());
    const withdrawal_id = list.items[0].id;
    const body = { partner_id: 2, withdrawal_id, action: "APPROVE", reason: "" };
    assert.equal((await request("withdrawal-decision", { method: "POST", body })).status, 403);
    const login = await request("login", { method: "POST", body: { email: "checker@example.test", password: "Wallet-checker-test-2026!" } });
    assert.equal(login.status, 200);
    cookie = login.headers.get("set-cookie").split(";")[0];
    assert.equal((await request("withdrawals?partner_id=2").then(r => r.json())).can_check, true);
    assert.equal((await request("withdrawal-decision", { method: "POST", body, origin: false })).status, 403);
    assert.equal((await request("withdrawal-decision", { method: "POST", body })).status, 200);
    assert.equal((await request("summary?partner_id=2").then(r => r.json())).balances.reserved, "50000");
    assert.equal((await request("withdrawal-transfer", { method: "POST", body: { ...body, action: "PROCESSING" } })).status, 200);
    for (let i = 0; i < 2; i++) assert.equal((await request("withdrawal-transfer", { method: "POST", body: { ...body, action: "SETTLED" } })).status, 200);
    assert.equal((await request("withdrawal-transfer", { method: "POST", body: { ...body, action: "FAILED", reason: "Late conflicting result" } })).status, 409);
    assert.deepEqual((await request("summary?partner_id=2").then(r => r.json())).balances, { available: "50000", clearing: "0", reserved: "0" });
    const history = await request("withdrawals?partner_id=2").then(r => r.json());
    assert.equal(history.items[0].status, "SETTLED");
    assert.equal(history.items[0].checked_by, 3);
    await request("logout", { method: "POST" }); cookie = makerCookie;
  });
  await t.test("sign-out clears the cookie and revokes the API token", async () => {
    const response = await request("logout", { method: "POST" });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("set-cookie"), /Max-Age=0/i);
    assert.equal((await request("context")).status, 401);
    cookie = "";
  });
  await t.test("users without a business see an access error, not zero balances", async () => {
    const response = await request("login", { method: "POST", body: { email: "viewer@example.test", password: "Wallet-test-only-2026!" } });
    assert.equal(response.status, 200);
    cookie = response.headers.get("set-cookie").split(";")[0];
    assert.equal((await request("context")).status, 403);
    await request("logout", { method: "POST" });
    cookie = "";
  });
});
