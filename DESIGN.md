# CommonThread — visual and interaction system

## Product experience

CommonThread should feel like a community finance workbench: calm enough for sensitive operational work, clear about the next action, and confident about where money can move. The design pairs an editorial sans-serif with a deep blue-to-teal brand gradient, crisp white records, and a restrained lime accent for primary actions. Avoid decorative AI motifs, floating cards, and generic dashboard filler.

## Visual tokens

| Token | Value | Use |
|---|---|---|
| `ink` | `#0B1D3B` | Main text, hero, high-contrast panels |
| `blue` | `#174CA1` | Brand and links |
| `teal` | `#087F91` | Gradient endpoint and secondary signal |
| `lime` | `#DDF36B` | Primary action and selected states |
| `canvas` | `#F3F6FA` | App background |
| `white` | `#FFFFFF` | Forms, request and payment records |
| `muted` | `#58677E` | Supporting copy and metadata |

## Typography and layout

Use Manrope with a system sans-serif fallback. Keep display text compact and expressive, while body and record text remain easy to scan at normal zoom. Use consistent spacing, restrained radii, clear column alignment, and one obvious primary action per view. On narrow screens, stack request and payment detail panels and preserve the same workflow order.

## Motion and accessibility

- Use short, low-distance transitions for navigation, request state changes, and plan loading.
- Motion must not gate payment, validation, or status information.
- Respect `prefers-reduced-motion`; all content and status remain available without animation.
- Keep visible focus, native labeled controls, adequate contrast, announced validation, keyboard access, and responsive behavior.
- Do not rely on hover-only information or color alone for payment and request status.

## Trust signals

- Show whether planning uses Gemini or local rules.
- Mark PayPal as sandbox and local records as no-charge.
- Show product name, quantity, unit price, line total, budget cap, and recalculated total before checkout.
- Keep request review, payment approval, and order activity visible as distinct stages.
- Label starter records and catalog data as illustrative; never imply that a request was verified or goods were delivered.
