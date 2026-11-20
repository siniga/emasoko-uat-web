# Wallet overview — Part 5

The `/wallet` page signs in with the portal's existing email/password API. The
browser calls only same-origin `/api/wallet` routes. The portal API token stays
in an HTTP-only, SameSite=Strict cookie scoped to those routes for 15 minutes.
It is never placed in local/session storage or returned as JSON. Sign-out asks
Laravel to revoke the token and clears the browser cookie even if Laravel is down.
Sign-in allows up to 30 seconds for the portal to respond; ordinary wallet reads
retain their shorter timeout. Timeout and connection failures have separate
messages so they are not confused with incorrect credentials.
This is the initial sign-in connection; role-specific 2FA/OTP work remains in later
security and outgoing-payment steps.

## Local use

Run Laravel from the sibling `portal` repository:

```powershell
php artisan serve --host=127.0.0.1 --port=8001
```

In the frontend, `PORTAL_API_URL=http://localhost:8000/api` is already used by
checkout. Set the server-only `WALLET_API_URL` if wallets need a separate API base.
The fallback is `http://127.0.0.1:8000/api`. The local Wallet uses `WALLET_API_URL=http://127.0.0.1:8001/api` so it reaches the sibling `portal` application even when port 8000 serves a different backend. No `NEXT_PUBLIC_` API token is needed.
For hosted HTTPS behind a reverse proxy, set `WALLET_ORIGIN` to the exact public
frontend origin. HTTP is accepted only for loopback development.

```powershell
npm run dev
```

Open `/wallet` and sign in with an existing active portal account linked to an
authorised business. Laravel needs Passport signing keys and a personal-access
client. This implementation generated the previously missing local keys without
replacing existing keys or clients. Keep keys private and configure deployed
environments separately; never rotate existing production keys as a setup shortcut.

Choose an authorised business to view its available, clearing and reserved funds.
Browser requests have a 20-second deadline (35 seconds for sign-in), including JSON decoding, so an unresponsive frontend produces a retry message rather than an indefinite spinner. Available already excludes reserved funds. Balances refresh every five seconds
while the tab is visible, and can be refreshed manually. Requests are aborted when
the business changes; errors hide old amounts instead of substituting zeros.
Amounts are formatted as whole TZS. Missing, fractional, negative, mismatched or
unsafe numeric responses are rejected.

## Part 6: simulated mobile-money collections

Apply the new backend migration `2026_11_15_000002_create_wallet_collections_table.php`
before using the simulator. In `APP_ENV=local` or `testing`, the Simulations page includes
“Test a mobile-money payment”. Production rejects the endpoint and hides the form.
Choose a payer, whole-TZS amount, mobile network and successful/failed result.
Successful tests credit available funds through the balanced ledger; failures
store their reason without changing funds. No provider is contacted or customer charged.
These are persistent test records in the selected business, not temporary previews.
Use a dedicated learning business. No credits are added automatically during setup.

The authenticated, same-origin POST proxy forwards an `Idempotency-Key` UUID to
`v1/wallet/simulate-collection`. Laravel locks the wallet and atomically saves the
attempt and ledger credit. Identical retries return the original record; changed
payloads with the same key return 409. If a response is lost, keep the form open
and use “Retry same payment”; its key and details remain unchanged until confirmed.
Controllers contain the simulation logic. The full Collections screen is Part 8.

## Checks

Part 12 adds explicit wallet-scoped simulated checker assignments. Authorised
membership alone grants no approval rights; the maker cannot check their own
withdrawal even if assigned as a checker. Simulations shows controls only for an
assigned checker reviewing another user's request. Withdrawals displays status,
checker identity and rejection/failure reasons. No role-assignment API is exposed.

Apply `2026_11_15_000005_add_wallet_withdrawal_decisions.php`. Approve changes
AWAITING_APPROVAL to APPROVED without moving funds. Reject reverses the original
reservation in full. Starting a simulated transfer changes APPROVED to PROCESSING;
unconfirmed transfers stay there with funds reserved. Confirmed success debits
reserved and credits bank payout (net) plus fee income (charge). Confirmed failure
reverses the reservation, including the charge. These transitions and their audit
events are atomic under the wallet lock. Duplicate actions return the recorded
result; conflicting final results and changed retry reasons are rejected. Frozen
wallets block approval/start but allow rejection and already-started final results.
Every write remains local/testing-only. Checker fixtures are isolated fictional
accounts. Live SMS, production roles and provider integration remain future work.

Part 11 adds simulated withdrawal requests. On Simulations, enter the total wallet
amount, request a withdrawal-specific OTP, review the server-calculated charge and
net amount, then confirm. Withdrawals lists requests and Overview/Statement reflect
the reservation. The illustrative TZS 2,500 fee is deducted from the total, so a
TZS 50,000 request reserves 50,000 and quotes 47,500 to the bank. No fee income or
bank payout is posted before completion. Approval and release/transfer are Part 12.

Apply `2026_11_15_000004_create_wallet_withdrawals.php`. A WITHDRAWAL OTP is bound
to the actor, wallet, dedicated account, amount, fee and request UUID. Practice
verification cannot authorise it. Five-minute expiry, five-attempt lockout and
30-second issuance cooldown apply. Creating the request atomically posts available
to reserved, consumes the code and saves AWAITING_APPROVAL. Wallet locks recheck
funds at submission; identical UUID retries return the original request. Changed
payloads conflict. Failed database writes roll back the journal, request and code
consumption. The browser retains the same payload/key after uncertain results.
POST withdrawal actions are local/testing only and require a simulated dedicated
account. Production writes remain disabled pending live SMS and role safeguards;
GET history is authorised in all environments. No test withdrawals are seeded in
the normal database. No new services or real bank calls are introduced.

Part 10 adds a read-only dedicated account card on Withdrawals. The Simulations
page can create a dummy account once and practise OTP entry. Account replacement
is blocked; live provisioning/replacement requires Operations verification and a
signed letter. No subscriber account-edit API is enabled in production.
Apply `2026_11_15_000003_create_wallet_bank_safeguards.php` first. Full account
numbers are encrypted using Laravel's application key; APIs return only last-four
masking. Simulated verification is explicitly labelled and is not live verification.

OTP practice generates a random six-digit code with a five-minute expiry. Only its
hash is stored. Codes are bound to the user, wallet, bank and SETUP_PRACTICE purpose.
Five wrong attempts lock the challenge; issuing another is limited to once per 30
seconds and invalidates the earlier challenge. Verification consumes it atomically.
These demo endpoints are local/testing only, return the code instead of sending an
SMS, never reserve money, and do not issue a withdrawal-authorisation token. Part 11
must use transaction-bound challenges, not practice verification, for real requests.
Account and challenge storage are persistent. No test account is seeded in the
normal application database. Use the Simulations page with a learning business.

Part 9 adds Wallet → Statement (`/wallet/statement`). One row represents one posted
ledger journal, ordered by its first ledger entry ID so same-second postings retain
their actual order. Each row shows the change and running balance for available,
clearing and reserved funds. Internal transfers affect two buckets without creating
new money; failed payment attempts have no journal and remain in Collections.
The read-only `v1/wallet/statement` controller calculates running sums in SQL before
pagination. A returned sequence anchor keeps subsequent pages on the same snapshot;
Refresh starts a new snapshot. Amounts are returned as exact decimal strings and the
frontend formats them using BigInt. Business authorisation and session handling are
shared with the other wallet pages. No schema change is required.

Part 8 replaces the Collections placeholder with authorised payment history.
The GET `v1/wallet/collections` API supports status, channel and 20-record page
filters; `collection_id` returns a single payment scoped to the selected wallet.
The frontend proxy selects safe fields and uses the existing HTTP-only session.
Users can view payer, amount, provider, status, attempted/available dates and failure
reason. Simulation records are labelled. Filters and business changes clear prior
results; loading, empty and error states are distinct. Refresh retrieves updated
settlement status. Collection reads work in production; simulation writes remain
restricted to local/testing. No schema change is required.

Payment simulations and bank settlement now live at `/wallet/simulations`, reached
through Wallet → Simulations. Overview displays balances only. Both pages reuse
the same sign-in cookie and authorised business selection; simulation availability
still comes from the backend environment capability.

Part 7 adds `BANK_SIM` to the test payment form. A successful bank test posts to
clearing first. The pending-bank section refreshes every five seconds and survives
page reloads. “Simulate settlement” transfers the amount from clearing to available,
and moves the platform receivable into the bank collection account. Wallet locks
and a collection-specific settlement journal key prevent duplicate settlement.
The original collection journal remains linked and unchanged. Failed and mobile
payments cannot use this action. Both bank endpoints require authorised membership
and are disabled outside local/testing. No schema change is needed for Part 7.

```powershell
npm run test:wallet
```

For end-to-end API checks, the backend fixture builder creates a new SQLite test
database at an explicit, non-existing `wallet-part5-fixture.sqlite` path:

```powershell
php tests/Fixtures/create_wallet_overview_database.php <absolute-test-database-path>
```

Run a separate Laravel process on port 8101 with `DB_CONNECTION=sqlite`,
`DB_DATABASE=<absolute-test-database-path>`, `APP_ENV=testing`, `CACHE_DRIVER=array`
and `SESSION_DRIVER=array`. These variables belong to that process only. Do not
change the real portal's `.env`. Run a separate Next server on port 3100 with
`WALLET_API_URL=http://127.0.0.1:8101/api`, then:

```powershell
npm run test:wallet:api
```

The API tests use only the fixture's fictional accounts and ledger entries. They
check login, cookie policy, business isolation, balance values, sign-out/revocation,
simulation success/failure, duplicate protection and no-business errors. Never point these tests at production or the normal
application database. Stop the fixture servers after testing.

