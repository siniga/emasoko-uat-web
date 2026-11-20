import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { walletBrowserRequest } from "../app/wallet/wallet-request.ts";

test("wallet reads finish or fail instead of loading indefinitely", async t => {
  const server = createServer((request, response) => {
    if (request.url === "/ok") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ value: 1 }));
    } else if (request.url === "/body") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.write('{"unfinished":');
    }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await t.test("successful JSON is returned", async () => {
      const { response, data } = await walletBrowserRequest(`${base}/ok`, {}, 3000);
      assert.equal(response.status, 200);
      assert.deepEqual(data, { value: 1 });
    });
    await t.test("a server that never sends headers is timed out", async () => {
      await assert.rejects(walletBrowserRequest(`${base}/headers`, {}, 100), { name: "TimeoutError" });
    });
    await t.test("a response that never finishes its JSON body is timed out", async () => {
      await assert.rejects(walletBrowserRequest(`${base}/body`, {}, 100), error => ["AbortError", "TimeoutError"].includes(error.name));
    });
    await t.test("changing business or unmounting still cancels requests", async () => {
      const controller = new AbortController();
      controller.abort();
      await assert.rejects(walletBrowserRequest(`${base}/ok`, { signal: controller.signal }), { name: "AbortError" });
    });
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});