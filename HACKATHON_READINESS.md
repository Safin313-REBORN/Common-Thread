# PayPal AI Hackathon readiness

Checked against the [official PayPal AI Hackathon rules](https://paypalaihackathon.devpost.com/rules) on November 6, 2026. The listed submission deadline is November 12, 2026 at 12:00 p.m. Pacific Time. The checkout and AI integrations are implemented, but a judgeable submission still needs working provider credentials, a source repository containing the code, and the required public video.

## Project requirement matrix

| Requirement | Status | What a judge can verify |
|---|---|---|
| Meaningful PayPal developer platform integration | Implemented in code; sandbox credentials still required | PayPal JavaScript Checkout and server-side Orders v2 create/capture, itemized line items, idempotency, buyer approval, inventory reservation, and capture verification. No real-money credentials are included. |
| Meaningful AI integration | Implemented and verified live | Gemini proposes catalog product IDs and quantities; the server revalidates every proposal. A workspace-aware assistant answers product questions and receives recent chat turns. The Gemini Interactions API uses `store: false`. The app retries a secondary model after transient failures and clearly labels deterministic planning and guided-help fallback. |
| Sign-in and judging | Implemented in code; Google/PayPal sign-in is opt-in | A prefilled, isolated, read-only judge account is available by default. Google OIDC and PayPal Login with PayPal activate when server-side credentials and exact callback URLs are configured. |
| Working prototype | Runs locally | Accounts, request review, plan editing and validation, no-charge local order records, support tickets, and CSV export work without provider credentials. Local order records do not send payments. |
| Judge documentation | Present | Start with `README.md`, then see `ARCHITECTURE.md`, `PRODUCT.md`, `RESEARCH.md`, and `SUBMISSION.md`. |
| Sponsor tool prize | Not targeted | No AG Grid, APIMatic, Astropods, Bryntum, Channel3, Elastic, KERNEL, Postman, Render, or Zapier integration is currently included. Sponsor tools are optional for the base challenge. |
| Agentic Commerce prize | Not claimed | The AI prepares a plan, but a person approves the purchase in PayPal. This is a human-reviewed PayPal + AI project, not an autonomous payment agent. |

## Category focus

The strongest fit is **Best Use of PayPal + AI**: AI creates a constrained purchase plan, while PayPal checkout and server verification carry the approved order through a payment state. **Most Impactful** is a possible secondary fit if the team adds organizer interviews or a pilot to validate the need; the product currently states this as a hypothesis. The official rules score technological implementation, design, potential impact, innovation, and presentation equally. A category fit is not a prediction of winning.

## Activate the integrations

1. Install Node.js 22.5 or newer and run `npm start`.
2. Create a free PayPal Developer account and a **Sandbox REST app**. Put the sandbox client ID and secret in `.env` as `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`.
3. Create a Gemini API key and set `GEMINI_API_KEY` in `.env`. `GEMINI_MODEL` defaults to `gemini-3.8-flash`; `GEMINI_FALLBACK_MODEL` defaults to `gemini-3.5-flash`.
4. Restart the server. Confirm `/api/health` reports `paypal-sandbox` and `gemini`, then use a PayPal sandbox buyer account to approve checkout; sandbox captures use test funds only.
5. Keep `.env` private. Never put provider secrets in browser code, screenshots, a public repository, or the Devpost project description.

Without PayPal credentials, CommonThread saves a no-charge local record. Without a working Gemini response, it uses deterministic catalog rules and guided support replies; the interface identifies this fallback. Do not present either fallback as a live PayPal transaction or a Gemini-generated answer.

## Local verification

Reviewed on November 6, 2026: JavaScript syntax checks passed; the shared judge workspace is isolated and read-only; the live health endpoint reports `aiMode: gemini` and `paymentMode: local-demo`. A live browser run verified a Gemini-generated kit and a Gemini support reply. During verification, Google returned HTTP 503 for `gemini-3.8-flash`; the configured retry succeeded with `gemini-3.5-flash`. The server logs only model names and failure status, never prompts or keys. The local Gemini key remains in the ignored `.env` with owner-only permissions. PayPal sandbox credentials are not configured, so live sandbox buyer approval and capture cannot be verified here; checkout remains a clearly labeled no-charge local record. All 25 checkout currencies match PayPal's published REST currency-code list, including RUB; Brazil, China, and Malaysia restricted currencies are filtered in signup and account settings, and the server rejects mismatched country/currency pairs.

The credential-free signup, request review, plan validation, local-order, receipt, history, login, live AI plan, and live AI chat flows were reviewed. PayPal sandbox authentication and buyer approval/capture remain unverified because no sandbox app credentials are configured. The local judge account is intentionally read-only, so use a separate personal account for full write-flow validation.

## Submission work outside this app

The official rules require Devpost registration and submission, a public source repository with the project code and license, and a publicly visible YouTube demo video shorter than three minutes. The MIT license and setup documentation are ready. The source is maintained in this project folder; publish it to the public source repository when preparing the entry. Video, deployment, and Devpost submission are intentionally left for the entrant. Devpost also needs a project description and functional demo access or complete setup and testing instructions. This project does not submit itself.

The rules include entrant eligibility and project-ownership conditions. Confirm those directly in the [official rules](https://paypalaihackathon.devpost.com/rules); they cannot be determined from the source code.
