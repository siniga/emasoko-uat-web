import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { fetchWalletPortal, walletLoginFailure, WALLET_LOGIN_TIMEOUT_MS } from "../app/api/wallet/wallet-connection.ts";

test("sign-in allows a portal response slower than the old 12-second limit", { timeout: 45000 }, async () => {
  const server = createServer((request, response) => {
    const timer = setTimeout(() => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ success: true }));
    }, 12500);
    response.on("close", () => clearTimeout(timer));
    request.resume();
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  try {
    const response = await fetchWalletPortal(new URL(`http://127.0.0.1:${server.address().port}/login`), {
      body: { email: "fixture@example.test", password: "test-only" }, timeoutMs: WALLET_LOGIN_TIMEOUT_MS,
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true });
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test("timeout failures are distinct from incorrect credentials and connection failures", () => {
  assert.deepEqual(walletLoginFailure(new DOMException("internal details", "TimeoutError")), {
    status: 504, message: "Sign-in took too long. Please try again.",
  });
  const unreachable = walletLoginFailure(new TypeError("private connection details", { cause: { code: "ECONNREFUSED" } }));
  assert.equal(unreachable.status, 502);
  assert.match(unreachable.message, /cannot be reached/);
  assert.doesNotMatch(unreachable.message, /private connection details/);
});

test("unexpected errors never expose internal details to the browser", () => {
  const result = walletLoginFailure(new Error("private password or token"));
  assert.equal(result.status, 502);
  assert.doesNotMatch(result.message, /private|password|token/);
});
