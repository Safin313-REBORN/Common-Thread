# Product need and India hackathon research

**Reviewed:** November 5, 2026  
**Challenge:** PayPal AI Hackathon, Build What's Next with PayPal and AI

## Decision

Keep the community mutual-aid audience, but change the product from a one-off AI kit builder into **CommonThread**, a community procurement and spend-control workspace. Its job is to help a small organizer move a supply request through review, create an itemized plan with server-checked catalog prices and limits, get a person to approve checkout, and retain a usable payment record.

This is a credible problem area, not yet proof that a specific organization will adopt this app. India giving research shows that in-kind support is common, and nonprofit guidance stresses transparent fund use and records. Neither source establishes demand for this exact workflow. The next validation step is to interview local organizers and observe how they currently approve and reconcile small purchases.

## Does someone need this?

The strongest evidence is for a gap between everyday community support and accountable operations:

- The 2025–26 *How India Gives* study surveyed 7,225 households across 20 states and conducted 20 qualitative interviews. It reports that 68% of respondents gave in some form; in-kind giving was the most common form at 46%, followed by cash at 44%, while about 30% volunteered. These are giving behaviors, not a survey of demand for software. They make item-level records a relevant product direction, but do not validate this product on their own. [Artha Global / Ashoka University CSIP](https://artha.global/project/how-india-gives-2025-26/)
- India's NGO Darpan guidance says nonprofit boards and management are responsible for transparent and accountable fund use, and discusses recordkeeping, fund restrictions, due diligence, and reporting. This supports building clearer controls and records. It does not mean this prototype is compliant with those requirements. [NITI Aayog NGO Darpan guidance](https://ngodarpan.gov.in/assets/ngo_doc/NPO_Guidance_Note_India_2023_v2.pdf)

**Product implication:** organizer request review, an explicit procurement state, itemized payment records, a visible approval point, and a saved activity trail are closer to the documented operating problem than a general-purpose donation bot. The initial users should be small local organizers who assemble goods from a fixed catalog; supporters and finance volunteers are secondary users.

## Representative India hackathon shortlist

This is a source-backed sample across major government, financial-sector, and national challenges. It is not an exhaustive list of every hackathon held in India, and a challenge theme is not a ranking of user demand.

| Challenge and result | What the winning work addressed | Product signal |
|---|---|---|
| **Singapore–India Hackathon 2023:** student winner built a tool to help regulators detect likely insider-trading suspects; startup winner Haqdarshak helped people access welfare services. | Financial-integrity detection and practical inclusion, tied to a defined user and outcome. | Use the AI for a specific review task; show how a person benefits and where a human remains responsible. [PIB](https://www.pib.gov.in/PressReleaseIframePage.aspx?PRID=1940014&lang=2&reg=48) |
| **Smart India Hackathon 2024:** government problem statements covered ministry challenges in areas including coal and housing/urban affairs; winners were named against those problem owners. | Solutions were scoped to concrete institutional problems rather than generic technology showcases. | Keep the user, request, and buying constraints explicit. Avoid pitching AI as the product by itself. [PIB winner list](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2085000&lang=2&reg=3) |
| **AB PM-JAY Auto-Adjudication Hackathon 2026:** winning work addressed claim-document classification and guideline checks, and detection of forged or manipulated documents. | Faster review with evidence checks, accuracy, and programme integrity. | Ground recommendations in source records; show status and provenance; keep people accountable for decisions. [PIB](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2259365&lang=2&reg=48) |
| **NHCX Hackathon 2026:** teams built standardized claim/document workflows and explored misuse detection and processing-time improvements. | Interoperable workflows, consistency, and less manual handling across organizations. | Persist a structured request and order record; make transitions and exports understandable to the next operator. [PIB / NHA](https://www.pib.gov.in/newsite/erelcontent.aspx?lang=2&reg=48&relid=285323) |
| **PSB Hackathon 2026 at IIT Gandhinagar / Bank of Baroda:** more than 450 applications led to 17 finalist teams; the challenge covered fraud, cybersecurity, inclusion, digital payments, automation, and customer experience. | Practical banking issues evaluated by banking and technology experts; the release names the top teams but does not publish enough detail to attribute specific features to each winner. | Treat payment safety, clear approval, and reconciliation as core product behavior. Do not claim a specific feature was a winner pattern without evidence. [PIB](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2296383&lang=2&reg=48) |

### Features selected from those signals

1. **Request intake and review states.** New needs enter Review; a workspace operator must move a request to Ready before planning can begin.
2. **Policy-bound AI recommendations.** The model can suggest only catalog IDs and quantities. The server owns price, stock, budget, and restrictions.
3. **Human payment approval.** The product requires a person to edit and approve the exact order; the model cannot create or capture a payment.
4. **Repeat-order awareness.** The planner warns when the same request has a recent saved, pending, or captured order so an organizer can check before repeating the purchase.
5. **Itemized financial records.** Order history includes payment status and provider reference. Organizers can export a CSV statement and open an activity record.
6. **Reviewable state history.** Request and payment events are stored as immutable records, making a status transition visible to the next operator.

These are selected product requirements, not claims that every winning team used them or that they are the most popular features across all hackathons.

## Challenge fit

The supplied PayPal challenge asks builders to meaningfully use both PayPal and AI, and to deliver an interactive, documented working prototype. It permits PayPal's free sandbox and does not prescribe a track. This concept gives PayPal a direct role in buyer-approved itemized checkout, and AI a constrained planning role before that approval. [Official PayPal AI Hackathon page](https://paypalaihackathon.devpost.com/) · [Official rules](https://paypalaihackathon.devpost.com/rules)

Previous official PayPal Dev Days winners also show the value of a focused job and concrete PayPal integration: CrawlerPal, Codebusters, and Team Rosen. Those winners came from a different event, so they are inspiration, not a prediction of this event's judging. [PayPal Dev Days 2025 winners](https://developer.paypal.com/community/blog/winners-dev-days-hackathon/)

## Product scope and honest limits

The workspace now supports request creation, review/ready/closed transitions, a request activity history, catalog-backed planning, request-specific budget caps, editable baskets, PayPal sandbox checkout when configured, local no-charge records, payment activity, and itemized CSV export.

The first-run records and catalog are illustrative starter data. The application runs as a local single-operator workspace. It does not have user accounts, organization isolation, real recipient verification, supplier feeds, real inventory, production payments, cross-border settlement, recipient payouts, or delivery confirmation. PayPal sandbox captures go to a test merchant. A local record sends no money. A request marked Ready is only a local operator's workflow decision, not identity, eligibility, or legal verification.

Do not present the current build as a live financial service or as evidence that aid was purchased or delivered. A production rollout would need a partner organization, user research, access control, real supplier/pricing agreements, verified need governance, provider webhooks/reconciliation, and a compliant payment/fulfillment model.

## Validation plan after this build

1. Interview five to ten community organizers about request intake, approval, duplicate purchases, and what records they must share with supporters.
2. Observe two real procurement workflows with consent; compare the current process to the request desk and export.
3. Secure one community partner and a supplier/catalog source before replacing starter records with live data.
4. Measure time to prepare and reconcile one request, number of corrections, and whether supporters understand the itemized record.

## Sources

- [How India Gives 2025–26 — Artha Global and Ashoka University CSIP](https://artha.global/project/how-india-gives-2025-26/)
- [NGO/NPO guidance on fund utilization and accountability — NGO Darpan / NITI Aayog](https://ngodarpan.gov.in/assets/ngo_doc/NPO_Guidance_Note_India_2023_v2.pdf)
- [Smart India Hackathon 2024 winners — Press Information Bureau](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2085000&lang=2&reg=3)
- [Singapore–India Hackathon 2023 winners — Press Information Bureau](https://www.pib.gov.in/PressReleaseIframePage.aspx?PRID=1940014&lang=2&reg=48)
- [AB PM-JAY Auto-Adjudication Hackathon winners — Press Information Bureau](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2259365&lang=2&reg=48)
- [NHCX Hackathon — National Health Authority / Press Information Bureau](https://www.pib.gov.in/newsite/erelcontent.aspx?lang=2&reg=48&relid=285323)
- [PSB Hackathon 2026 — Press Information Bureau](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2296383&lang=2&reg=48)
- [PayPal AI Hackathon and rules](https://paypalaihackathon.devpost.com/), [PayPal Dev Days 2025 winners](https://developer.paypal.com/community/blog/winners-dev-days-hackathon/)
