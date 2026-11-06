# Judge setup and walkthrough

CommonThread is a local-first prototype for community organizers. It keeps a request, a human-reviewed supply plan, and the resulting order record together. The starter catalog and sample requests are illustrative; do not enter personal or sensitive information.

## Start the app

Requirements: Node.js 22.5 or newer. The app uses Node's built-in HTTP server and SQLite; it does not need an `npm install` step.

```bash
git clone https://github.com/Safin313-REBORN/Common-Thread.git
cd Common-Thread
cp .env.example .env
npm start
```

Open [http://localhost:3000](http://localhost:3000). The public judge account is prefilled on the sign-in page:

| Email | Password | Limits |
|---|---|---|
| `demo@commonthread.test` | `CommonThreadDemo2026!` | Read-only sample workspace; plan generation and review work, but saving changes and orders is disabled |

To try editable requests and order records, sign out and create a personal local account. No email verification is required by this prototype. The demo workspace is isolated from personal accounts.

## Follow the main workflow

1. On **Build a kit**, review the sample need and the planner's itemized proposal.
2. Change a quantity or remove a product. The app recalculates the total and budget remainder.
3. Open **Requests** to see review states and activity history. A request must be marked Ready before it can be planned.
4. Open **Payments** to inspect saved order records and export the ledger as CSV.
5. Open **Account** to review profile, region, currency, session, and support settings. Open **Contact** to save a support ticket.
6. Ask the workspace assistant a product question. It has no tools and cannot approve a request or start a payment.

## Enable live provider integrations

Provider credentials are intentionally absent from this public repository. They are optional for the local walkthrough and must be supplied by the person running the app.

**Gemini planning and support**

1. Add a Google AI Studio API key to `.env` as `GEMINI_API_KEY`.
2. Restart the app. `GET /api/health` should report `aiMode: "gemini"`.
3. Build a plan and send a support question. The UI identifies Gemini responses; if the provider is unavailable, it labels the local fallback.

**PayPal sandbox checkout**

1. Create a PayPal Developer sandbox REST app and a sandbox buyer account.
2. Add its sandbox client ID and secret to `.env` as `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`. Never place the secret in browser code or commit `.env`.
3. Restart the app. `GET /api/health` should report `paymentMode: "paypal-sandbox"`.
4. Use a personal CommonThread account, mark a request Ready, review the proposed items, and approve checkout with the sandbox buyer. The app verifies the captured order status, amount, and currency before recording the payment.

PayPal captures in this project are sandbox transactions using test funds. With no PayPal credentials, the app records a clearly labeled no-charge local order; it does not send a payment. The PayPal flow is implemented but has not been verified end-to-end in the maintainer's environment because sandbox credentials are unavailable.

## What the prototype demonstrates

- Gemini proposes product IDs and quantities from a fixed catalog; server rules recheck prices, inventory, restrictions, and budget.
- An organizer reviews and edits the plan. The AI cannot approve a request or call PayPal.
- PayPal Checkout and Orders v2 sandbox create/capture are implemented. Checkout is never live-money mode.
- SQLite stores local workspaces, requests, audit events, orders, and support tickets.
- Without Gemini or PayPal keys, the local planning/support fallback and no-charge record path remain available and are labeled in the UI.

## Known limits

This is not a production banking, charity disbursement, or fulfillment system. The starter catalog and requests are illustrative. There are no connected suppliers, verified requesters, recipient payouts, shipments, refunds, production PayPal payments, or email notifications. Currency conversion uses a daily reference rate and may differ from PayPal's final rate and fees. Use only sample data during evaluation.

For the data model and security notes, see [ARCHITECTURE.md](ARCHITECTURE.md). For the full submission summary and walkthrough script, see [SUBMISSION.md](SUBMISSION.md).

## Optional Render deployment

Render can host the app as a Node.js web service. The project pins Node.js `24.21.0` with `.node-version` and reads Render's assigned `PORT`.

1. Create a **Web Service** from this repository's `main` branch. Use `npm install` as the build command and `npm start` as the start command.
2. Attach a persistent disk mounted at `/var/data`.
3. Add `HOST=0.0.0.0`, `DATABASE_PATH=/var/data/commonthread.sqlite`, and `SESSION_COOKIE_SECURE=true` in the service's environment settings. Render sets `PORT` automatically.
4. Set `/api/health` as the health-check path. Add `GEMINI_API_KEY` and PayPal sandbox credentials only if you have them; add them as private environment variables, never to the repository.

The SQLite file must live under the mounted disk. Without a persistent disk, the service may start but account, request, and order data can disappear on restart or redeploy. The Render free web-service plan does not support persistent disks. For a temporary free preview, omit the `DATABASE_PATH` override so SQLite uses the app's default `data` directory; add the paid persistent disk before relying on saved data.
