# Checkout setup and deployment

The frontend and sibling `portal` Laravel repository must be deployed together when the checkout API contract changes.

## Local setup

1. Run `npm ci` in the frontend.
2. Copy `.env.local.example` to `.env.local` only if the local file does not already exist.
3. In Laravel's private local `.env`, use `APP_ENV=local` and `CYBERSOURCE_CHECKOUT_ORIGIN=https://localhost:3000`. Keep merchant credentials in Laravel. Run `php artisan config:clear` after changing its environment.
4. Start Laravel in the sibling `portal` folder with `php artisan serve --host=localhost --port=8000`.
5. Run `npm run dev:https` in the frontend, then open `https://localhost:3000/equity-checkout`.

Checkout requires HTTPS and the exact frontend origin configured in Laravel. Local development can still use a production merchant account: the application environment does not choose the payment provider environment.

## Backend contract

The browser calls the Next.js proxy at `/api/equity-checkout/context`, `/api/equity-checkout/begin`, and `/api/equity-checkout/status`. The proxy forwards to these paths under `PORTAL_API_URL`:

| Path | Laravel handler |
| --- | --- |
| `/cybersource/capture-context` | `EquityCheckoutController@context` |
| `/cybersource/checkout/begin` | `EquityCheckoutController@begin` |
| `/cybersource/checkout/status` | `EquityCheckoutController@status` |

Routes retain `throttle:10,1`. The old authorization routes return 409 and ask stale clients to reload. They never submit another charge. Do not map checkout routes to `CybersourceTestController`.

Context returns the existing session fields plus `flow=sale-v1` and `environment`. Client version 0.28 uses the Accept SDK and `completeMandate.type=CAPTURE` with `consumerAuthentication=true`. The merchant ID must be enrolled for Unified Checkout and Payer Authentication; confirm the enabled currencies and acquirer settings in Business Center.

Begin accepts `checkout_id` and `transient_token`, verifies the token signature and expiry, and records a single submission. It does not process a payment. After begin returns `proceed=true`, the browser calls `up.complete(token)` once. Cybersource runs supported payer authentication and requests authorization plus capture. Never also call the Payments API for this token: that could create a duplicate charge.

Status accepts `checkout_id` and an optional numeric `payment_id` from completion. Laravel retrieves the transaction through the authenticated Transaction Details API and checks its merchant ID, reference, amount and currency against the saved checkout. Browser-provided statuses are ignored. Only a verified `SETTLED` transaction is returned as `paid=true`; `AUTHORIZED`, `PENDING` and `TRANSMITTED` do not confirm collection. A report can lag processing, so an unavailable or mismatched result stays `UNKNOWN` and may be checked again without resubmitting payment.

The frontend retains only the checkout ID, reference, environment and returned transaction ID in session storage, and checks status every 15 seconds for up to eight attempts. The manual status button remains available. Laravel retains checkout records for 30 days in its configured cache. Use persistent shared cache storage with atomic locks on every instance; clearing or evicting these records removes in-app reconciliation. Business Center remains the recovery path if a browser closes before receiving a transaction ID. This standalone checkout does not credit a wallet or fulfill an order.

## UAT environment

Create the frontend server's `.env.production` from `deploy/uat.env.example`. Do not upload `.env.local` or commit `.env.production`. Next.js gives `.env.local` precedence over `.env.production`, so uploading a local file can override hosted settings.

In Laravel's private server `.env`, set:

```dotenv
APP_ENV=production
APP_DEBUG=false
CHECKOUT_ENABLED=true
CYBERSOURCE_CHECKOUT_ORIGIN=https://165.245.192.26
```

Keep the existing merchant credentials, database, cache, and other settings. Both apps require an explicit `CHECKOUT_ENABLED=true` outside local development. Origins have no path or trailing slash. All checkout settings stay server-side, without `NEXT_PUBLIC_` prefixes. The Laravel `.env.example` contains checkout settings only; it does not replace a complete application environment.

## Deployment

Commit and push the intended fixes in **both repositories** first. Run each command as the deployment user and stop if any fails. If Git reports server-side changes, review and preserve them before pulling.

Laravel, from `/var/www/api`:

```bash
git pull --ff-only origin main
composer install --no-dev --prefer-dist --optimize-autoloader
php artisan config:cache
php artisan route:clear
php artisan route:list --path=cybersource
```

Confirm context, begin and status resolve to `EquityCheckoutController`. The disbursement controller import must use `Api\CRDB`, matching the directory capitalization on Linux.

Frontend, from `/var/www/web`:

```bash
git pull --ff-only origin main
npm ci
npm run build
pm2 restart emasoko-web --update-env
pm2 save
```

If logged in as root, use `sudo -u deploy -H` for these commands where `deploy` owns the checkout and PM2 process. Reload PHP workers through your hosting setup if opcode caching does not pick up the deployed code.

Test first with `CYBERSOURCE_ENVIRONMENT=apitest.cybersource.com` and test merchant credentials kept privately in Laravel. Verify card entry, both frictionless and challenged 3-D Secure, capture submission, pending-to-settled reporting, declines, status checks after reload, and repeated begin rejection. Then confirm the capture/settlement in Business Center. A build or capture-context response does not verify a payment. Production validation requires a separately authorized transaction; the local checks do not charge a card.

Deploy both applications together. Previously authorized holds are not automatically captured by this change. Review their current status and capture eligible existing authorizations separately in Business Center rather than charging the customer again.
