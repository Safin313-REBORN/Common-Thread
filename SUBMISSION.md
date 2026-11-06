# Hackathon submission — CommonThread

## Short description

CommonThread is a community procurement and spend-control workspace. It takes a request from intake through human review, uses AI to draft an itemized catalog-priced plan under a spending cap, and keeps the order, PayPal payment state, and activity history together. Deterministic server rules validate every SKU, quantity, restriction, price, and total. A person reviews the request and plan, then approves any PayPal sandbox checkout.

The current build runs locally with an illustrative catalog, local SQLite records, optional Gemini planning, and optional PayPal sandbox checkout. Sandbox transactions do not move real money or fulfill orders.

## Why this is useful

Small community groups often coordinate needs in messages and reconcile purchases across separate notes and receipts. CommonThread tests whether a single request-to-order record can make approvals and spending easier to review. The need for a transparent workflow is supported by nonprofit accountability guidance and Indian giving research, but adoption of this product itself remains a hypothesis pending organizer interviews and a partner pilot.

## What is implemented

- Request intake with broad location, category, practical description, and USD planning cap.
- A review / ready / closed lifecycle with append-only activity records.
- Catalog-constrained Gemini planning with a clearly labeled deterministic local fallback when the provider is unavailable.
- Editable itemized cart with server validation for products, stock, restrictions, and budget.
- A duplicate-order review warning for recent activity on the same request.
- PayPal JavaScript Checkout and Orders v2 sandbox create/capture with idempotency, stock reservation, buyer approval, and capture amount verification.
- No-charge local order records, itemized receipts, order activity, and CSV export.
- Password-based accounts, private workspaces, session management, region/currency settings, a workspace-aware support assistant, and saved contact tickets.
- Responsive interface with keyboard support, visible focus, and reduced-motion handling.

## Two-minute walkthrough

1. **0:00–0:20 — Start with a request.** Open the request desk, add a need with a broad location, and show that new records start in Needs review.
2. **0:20–0:40 — Show the human checkpoint.** Move it to Ready to plan and open the kit builder.
3. **0:40–1:05 — Build and inspect.** Describe the kit, choose a budget, and show the catalog-backed itemized proposal and server-checked total.
4. **1:05–1:25 — Edit and validate.** Change a quantity or remove a line; show the budget meter and request/order controls.
5. **1:25–1:45 — Record payment intent.** Save a no-charge local record or use a PayPal sandbox buyer account if credentials are configured.
6. **1:45–2:00 — Reconcile.** Open Payments, inspect the immutable activity and line-item snapshot, and export the ledger CSV.

## Evidence and product limits

The research notes cite a representative set of Indian hackathon winners and challenge themes, plus Indian giving and nonprofit accountability sources. This is not an exhaustive survey or a ranking of user demand. Challenge winners demonstrate judged problem fit, not market validation for CommonThread.

The system includes password-based accounts and workspace-scoped request/payment records, but it does not include email verification or recovery, multi-user invitations, verified requesters, a real supplier feed, live inventory, recipient payouts, shipment, refunds, webhook reconciliation, or production payment configuration. Currency conversion uses a daily reference rate, not PayPal's final quote. Do not describe a sandbox capture as a real community purchase. See [PRODUCT.md](PRODUCT.md), [ARCHITECTURE.md](ARCHITECTURE.md), [RESEARCH.md](RESEARCH.md), and [HACKATHON_READINESS.md](HACKATHON_READINESS.md) for details.

## Challenge requirement check

- **PayPal developer platform:** Implemented through PayPal JavaScript Checkout and server-side Orders v2 sandbox create/capture. This local environment has no sandbox client ID or secret, so checkout currently saves no-charge local records until configured.
- **AI:** Gemini Interactions is implemented for catalog-constrained planning and workspace-aware support. A local Gemini key is configured, but Google returned a temporary high-demand response and a retry timed out during review. The app now falls back to labeled local planning and guided help; a successful Gemini response has not yet been verified.
- **Working prototype:** The SQLite app runs on Node.js 22.5+ and supports accounts, request review, plan editing, local order records, contact tickets, and CSV export. Full Gemini and PayPal sandbox flows need their respective keys.
- **Documentation:** Setup, data flow, product scope, research notes, and a walkthrough are documented. Optional sponsor tools are not currently used.

The public GitHub repository has been created at [commonthread-paypal-ai](https://github.com/Safin313-REBORN/commonthread-paypal-ai), but it is empty because source publishing has not succeeded. No public YouTube demo has been recorded. The official submission requires a public source repository containing the project code and a publicly visible demo video under three minutes. Publish the reviewed source and add the video through Devpost; this local build does not submit an entry. Review the [official rules](https://paypalaihackathon.devpost.com/rules), including eligibility, project ownership, and submission conditions, before entering.
