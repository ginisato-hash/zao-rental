# Avatar Production readiness gate

This document grants no Production or main-merge permission. The Phase7-B Tier2
override targets implementation completion and a Draft PR with passing CI; it does not
rebuild Hosted infrastructure. Production deployment and activation remain blocked.

| Gate | Required decision or proof |
|---|---|
| Artwork rights | Current derivatives have `productionApproved=false` and `publicApproved=false`. Explicit Owner/legal/business approval is required before public or Production Avatar activation. |
| Neon | Fresh Production credentials for exact least-privilege runtime roles; never owner/admin credentials. Preview credentials cannot be reused. |
| Private media | Private R2 delivery with guest ownership and current rights reauthorization. Public buckets, r2.dev and public custom domains are prohibited. |
| Environment | Avatar feature/capability defaults OFF. A separately reviewed Production configuration is required; the Preview capability cannot authorize Production. |
| Rollback | Remove Avatar capability/config to disable media visualization while preserving booking behavior. Prove this in the approved Production composition; deleting the current combined Preview runtime capability disables the whole synthetic Preview Guest runtime, so it is not a Production booking rollback mechanism. |
| Observability | Track Avatar media failures separately from business booking failures; never log credentials, raw provider payloads, guest identifiers or signed media URLs. |
| Network | Monitor unexpected APP egress separately from evidence-supported platform/browser traffic, with origin-only safe metadata. |

Main integration review, artwork rights decision and Production activation architecture
approval are separate Owner/Technical Director gates. No Phase8 or Production auto-start.
