# R14 protected ingress and external blockers

Checked 2026-09-15. Classification: **BLOCKED_PROTECTED_WEBHOOK_INGRESS** (documented compatible route not established), **BLOCKED_VERCEL_LOGIN** (latest existing CLI metadata check reports authentication required), and **BLOCKED_EXTERNAL_DB_PROVISIONING** (no verified cloud development DB configured for this acceptance).

No new login was initiated because login alone cannot resolve the ingress/cloud architecture gates. Three metadata-only CLI attempts returned no successful project readback; early failures had insufficient classification, the final attempt identified authentication required. No values were requested, saved or shown. Current protection settings were therefore **not freshly verified**. Historical protected R3 Preview evidence is not presented as current proof; no project setting or historical deployment was modified.

## Official documented routes

| Mechanism | R14 applicability |
|---|---|
| Automation secret in header | Requires the webhook sender to set the Vercel header; Square subscription documentation does not expose arbitrary header injection. No compatible Square configuration established. |
| Automation/share secret in URL query | Explicitly prohibited by R14. Not used. |
| Deployment exception | Opens a preview domain; does not provide the requested single POST route exception. Not used. |
| OPTIONS allowlist | Only CORS OPTIONS; cannot admit Square POST. |
| Trusted Sources OIDC | Requires sender-issued OIDC identity. No Square webhook OIDC mechanism established. |
| App routing/middleware exemption | Protection applies before middleware; an app rewrite does not satisfy platform authentication. |

Sources read:
- [Vercel protection](https://vercel.com/docs/deployment-protection)
- [Vercel documented exceptions and machine access](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection)
- [Square subscriptions](https://developer.squareup.com/docs/webhooks/step2subscribe)

This is a bounded finding from those documented mechanisms, not a claim that every possible future provider feature is impossible. Without a compatible verified route, R14 explicitly requires no subscription/payment dispatch. No unapproved relay, new provider, domain exception, public bypass URL, production routing or protection relaxation was used.

## Owner decision needed before live continuation

Select/approve an isolated development DB reachable from a hosted receiver and a supported machine-only ingress architecture that preserves ordinary Preview protection. A new relay/provider or changed protection scope requires new authority; it has not been selected or built here. When that route is viable, restore ordinary Vercel CLI authentication and read-only verify the current project protection before any deployment. Secrets remain outside chat/repository. R14 external counters remain zero; no claim is made for live webhook/provider/business E2E.

This is a continuation blocker record, not the P7 production gate. Production remains unauthorized.
