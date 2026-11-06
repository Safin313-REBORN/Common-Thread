# Product brief — CommonThread

## Positioning

**CommonThread helps small community organizers keep a clear record from a supply request through an approved purchase.** The workspace captures the need, holds it for organizer review, assembles a catalog-priced plan, and records the resulting payment state and itemized receipt.

## User and job

- **Primary user:** a coordinator at a small mutual-aid group or community organization.
- **Secondary users:** a finance volunteer and a supporter who wants to inspect what a purchase includes.
- **Job:** “Help me turn a request into a purchase plan my team can review, approve within a cap, and reconcile afterward.”

## Problem hypothesis

Requests often arrive as free text, while organizers need a concrete list, a spending limit, and a record they can share. Research supports the importance of in-kind support and transparent nonprofit operations, but no organizer has yet validated this specific product. Treat adoption and impact as hypotheses until interviews and a partner pilot are complete.

## Product flow

1. Add a community need using a broad location and a description without recipient identity details.
2. Keep the request in Review until an organizer decides it is ready for planning.
3. Build an itemized plan using Gemini recommendations or deterministic local rules.
4. Recompute catalog IDs, prices, availability, restrictions, and request cap on the server.
5. Review and edit every line. See a recent-order warning before repeating a purchase for the same request.
6. Save a no-charge local record or complete buyer-approved PayPal sandbox checkout.
7. Review request/payment activity and export itemized records for reconciliation.
8. Manage the organizer's account, private workspace, sessions, market, and checkout currency.
9. Ask workspace-aware product support or submit a ticket saved to the workspace.

## Product rules

- AI cannot choose a price, add an unknown product, approve a request, or trigger a payment.
- Only requests in Ready status can be planned or checked out.
- The server validates the exact order before creating a PayPal checkout.
- A human approves the exact purchase in the PayPal buyer flow.
- Request and payment events are append-only records.
- “Ready” is an internal workflow status; it is not identity or eligibility verification.
- Local payment records do not send money. PayPal sandbox captures are test transactions to a test merchant.

## Implemented scope

- Request intake with title, category, broad location, description, and USD planning cap.
- Request lifecycle: Review, Ready, Closed, with timestamped activity history.
- Fifteen illustrative catalog products with stable IDs, integer-cent prices, availability, tags, and restriction metadata.
- Gemini Interactions API plan generation and workspace-aware product support, with local guided fallbacks when no Gemini key is configured.
- Human-editable cart and server-side product, stock, restriction, and budget validation.
- PayPal Orders v2 sandbox create/capture, itemization, idempotency, temporary inventory reservations, and capture verification.
- Local no-charge order records, payment status history, itemized activity, and CSV export.
- Password-based accounts, private workspace records, profile and password management, session revocation, and saved support tickets.
- Curated PayPal country/currency settings, correct minor-unit handling, and dated FX snapshots on orders.
- Responsive interface, accessible native controls, visible focus states, and reduced-motion support.

## Not implemented

Email verification, password-reset email, MFA, workspace invitations, multiple reviewer roles, request evidence uploads, identity or recipient verification, live suppliers/prices/inventory, shipping, live PayPal payments, disbursements, refunds, webhook reconciliation, full multi-currency accounting, and production monitoring are outside this hackathon build. The contact form stores tickets in SQLite but does not send email notifications. The service binds to localhost by default; do not expose this single-instance SQLite workspace to the public internet with real data.

## Success measures for a partner pilot

- Organizer can add and review a request without entering sensitive recipient data.
- Team can assemble and edit a budget-compliant plan in under one minute.
- No AI-generated product, price, or amount can bypass server validation.
- Every order has an itemized snapshot, explicit payment state, and reviewable activity.
- CSV export reconciles to the order record without manual re-entry.
- Organizers and supporters can explain exactly what the app does and what it does not verify.
