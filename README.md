# CommonThread

**Community procurement, clearly recorded.** Each team gets a private workspace to capture community requests, review them, draft an itemized supply plan, manage payment activity, and keep the audit trail together.

The planner can recommend catalog items, but it cannot approve a request or start a payment. The server owns catalog prices, availability, restriction checks, budget validation, order snapshots, reservation state, and PayPal capture verification. A person reviews each plan and approves checkout.

## Run locally

Requirements: Node.js 22.5 or newer. The app uses Node's built-in HTTP server and SQLite locally, with the `pg` driver available for a hosted PostgreSQL database.

```bash
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000), create your account, and name your workspace. The first account adopts any existing local starter requests and payment history so those records remain available. Later accounts start with private, empty request and payment lists. The illustrative starter catalog is shared across workspaces.

For judge walkthroughs, the login page opens with the shared account prefilled:

| Demo ID | Password | Access |
|---|---|---|
| `demo@commonthread.test` | `CommonThreadDemo2026!` | Read-only; planning is available, saved changes and orders are blocked |

The demo account and workspace are created or reset when the server starts. Override `DEMO_EMAIL` and `DEMO_PASSWORD` for private use, or set `DEMO_LOGIN_ENABLED=false` to disable it. Keep personal information out of this shared account.

## Accounts and security

- Passwords use salted scrypt hashes; raw passwords are never stored.
- Sessions use random, HTTP-only, same-site cookies and expire after seven days. Session records store token hashes.
- Authenticated state changes require a same-origin check and per-session CSRF token.
- Sign-in attempts are rate-limited. Account settings let a user change their password, revoke other sessions, update their profile, and review their support tickets.
- Request, activity, planning, order, payment, and support queries are scoped to the signed-in workspace.

This build does not have email verification, password-reset emails, multi-user invitations, or role-based approval policies. The account owner is the only member created during signup. Without PayPal sandbox credentials, checkout saves a no-charge local record; when Gemini is unavailable, planning and help use a clearly labeled local fallback. See [HACKATHON_READINESS.md](HACKATHON_READINESS.md) for the exact setup and submission checklist. Do not expose this local server to the public internet or store sensitive personal data.

## AI planning and support

Set `GEMINI_API_KEY` in `.env` to enable the Gemini Interactions API for procurement planning and the workspace assistant. Set `GEMINI_MODEL` for the primary model and `GEMINI_FALLBACK_MODEL` for one retry after transient provider failures (defaults: `gemini-3.8-flash` then `gemini-3.5-flash`). Both requests use `store: false`. The planner receives the selected request, its budget and restrictions, and available catalog facts; it returns only proposed items. The assistant receives the workspace name, market, currency, aggregate counts, and recent chat turns. It has no tools and cannot change records or initiate payments.

Without a key or a successful model response, kit planning uses deterministic catalog rules and the assistant answers a small set of product-support questions. The UI identifies which mode is active. Avoid entering names, exact addresses, health information, payment credentials, or other sensitive details in AI prompts.

## PayPal and currencies

The account settings include a country/region and a PayPal checkout currency. The country selector is a curated subset of [PayPal REST API countries](https://developer.paypal.com/api/codes/country-region), and checkout currencies follow [PayPal's supported currency list](https://developer.paypal.com/api/codes/currency/). Local currency is shown separately from checkout currency. PayPal country availability and account features vary; the selection does not guarantee that a merchant account can receive every payment type.

Catalog prices and request budgets are maintained in USD reference values. For another supported PayPal checkout currency, the server fetches a daily reference rate from Frankfurter, converts and rounds prices using the currency's minor-unit rules, and saves the rate and date with the order. A fresh rate is required before a non-USD order can be saved. This reference is an estimate: PayPal may apply its own conversion rate and fees. BRL, CNY, and MYR are restricted to in-country PayPal accounts; HUF, JPY, and TWD do not accept fractional units. If the current rate is unavailable, use USD or try again later.

To enable sandbox checkout:

1. Create a REST app in the [PayPal Developer Dashboard](https://developer.paypal.com/dashboard/).
2. Set `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` in `.env`.
3. Restart the server and use a PayPal sandbox buyer account.

## Google and PayPal sign-in

Google and PayPal identity buttons activate only after their server-side client ID and secret are configured. The first sign-in creates a workspace; later sign-ins recognize the provider account. Verified provider email can connect an existing non-demo account. The app requests only `openid profile email`; PayPal identity sign-in is separate from checkout and does not access bank details, balances, or payment credentials.

1. For Google, create an OAuth web application and add `http://localhost:3000/api/auth/oauth/google/callback` as an authorized redirect URI. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env`.
2. In PayPal Developer, enable **Log in with PayPal** and whitelist `http://localhost:3000/api/auth/oauth/paypal/callback` as the return URL. Choose only the basic `openid`, `profile`, and `email` scopes. Set `PAYPAL_LOGIN_CLIENT_ID`, `PAYPAL_LOGIN_CLIENT_SECRET`, and `PAYPAL_LOGIN_ENV=sandbox`.
3. Register the exact scheme, host, port, and callback path used by the app. For HTTPS deployment, set `GOOGLE_OAUTH_REDIRECT_URI` and/or `PAYPAL_LOGIN_REDIRECT_URI` to the matching deployed callback.
4. Restart the server. These identity credentials are separate from `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`, which power checkout.

The public client ID loads PayPal's JavaScript SDK; the secret stays on the server. The server persists an order and reserves illustrative catalog quantities before creating the PayPal Orders v2 purchase unit. It verifies the captured status, currency, and minor-unit amount before consuming the reservation and saving the capture reference.

Without credentials, the workspace can save a local no-charge order record. This does not send a payment or reserve stock. Sandbox captures use test funds and do not buy or ship goods.

## Contact

The public Contact page stores support requests in the configured database, links them to the signed-in workspace when available, and shows ticket history in Account settings. Configure `SUPPORT_EMAIL`, `SUPPORT_PHONE`, or `SUPPORT_URL` to publish direct contact details. The local form does not send email notifications.

## Walkthrough

1. Create an account and select your community's country and checkout currency.
2. Open Requests and review a starter record or add a community need with a broad location and planning cap.
3. Move the request from Review to Ready after an organizer checks it.
4. Build a kit, inspect and edit every line, then save a no-charge record or complete sandbox checkout.
5. Open Payments to inspect the order snapshot, payment state, saved FX reference, activity, and CSV export.
6. Use the assistant for product help; use Contact for a support ticket.

See [JUDGE_GUIDE.md](JUDGE_GUIDE.md) for the shortest setup and evaluation path, [HACKATHON_READINESS.md](HACKATHON_READINESS.md) for the requirement-by-requirement status, [RESEARCH.md](RESEARCH.md) for the benchmark and evidence caveats, [SUBMISSION.md](SUBMISSION.md) for the pitch and walkthrough, [PRODUCT.md](PRODUCT.md) for scope, and [ARCHITECTURE.md](ARCHITECTURE.md) for the backend and data model.

## API overview

| Route | Purpose |
|---|---|
| `GET /api/health`, `GET /api/markets`, `GET /api/contact` | Public health, market, and configured support details |
| `POST /api/auth/signup`, `POST /api/auth/login`, `POST /api/auth/logout` | Create account and manage password sign-in |
| `GET /api/auth/providers`, `GET /api/auth/oauth/:provider/start`, `GET /api/auth/oauth/:provider/callback` | Provider readiness and Google/PayPal OpenID Connect sign-in |
| `GET /api/auth/session` | Current account and CSRF token |
| `PATCH /api/account/profile`, `POST /api/account/password` | Profile, workspace, region, and password settings |
| `GET /api/account/sessions`, `DELETE /api/account/sessions` | Review or revoke other sessions |
| `GET /api/account/support`, `POST /api/contact` | Workspace support tickets and new support request |
| `GET /api/config`, `/api/board`, `/api/catalog` | Authenticated workspace and catalog state |
| `POST /api/needs`, `PATCH /api/needs/:id/status`, `GET /api/needs/:id/events` | Workspace-scoped request workflow |
| `POST /api/agent/kit`, `POST /api/assistant/chat` | Procurement plan and product-support assistant |
| `POST /api/orders`, `POST /api/local-orders` | Create a currency-aware PayPal sandbox or no-charge record |
| `POST /api/orders/:id/capture`, `/api/orders/:id/cancel`, `GET /api/orders` | Capture, cancel, and view workspace payment activity |

## Current limits

The starter catalog and request history are illustrative; supplier catalog, identity verification, recipient payouts, refunds, fulfilment, webhooks, and live PayPal checkout are not connected. The FX quote is a daily reference rate, not PayPal's final conversion quote. SQLite is for local single-instance use; hosted services can use PostgreSQL through `DATABASE_URL`. Diet and allergen labels are catalog metadata, not safety certification.

## License

MIT. See [LICENSE](LICENSE).
