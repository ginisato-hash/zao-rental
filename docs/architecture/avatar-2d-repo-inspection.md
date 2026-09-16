# Avatar 2D/2.5D — post-R15 repository reconciliation

Base: `efb73933a6d3816958882205cfa3623447194625`, R15_PASS / Sandbox E2E validated.
Branch: `codex/post-r15-avatar-a2-a3`. Historical A0/A1 design input:
`9783373612440acef4c077b0ae23925aa467743d` on `codex/avatar-2d-foundation`.
Both historical branches remain unchanged; no merge/cherry-pick of their entry gates.
Current authority is [Post-R15 A2/A3](../execution/POST_R15_AVATAR_A2_A3_AUTHORITY.md).

| Area | Verified current implementation | A2/A3 use |
|---|---|---|
| Runtime | Node24.15.0/npm11.12.1; Next16.3.4/React19.3.0, TypeScript5.9.3 | Existing stack, no dependency additions |
| DB | PostgreSQL/pg, limited Drizzle metadata; explicit SQL migrationPlan in packages/db/src/index.ts | Add0031 after the verified0001–0030 prefix |
| Ledger | ledger_models/ledger_variants UUIDs; catalog season and variant compatibility immutable | Nullable visual references; exact SKI promise checks model/variant/season/physical length |
| Recommendation | Profile, MemberRecommendation, Candidate.lengthCm and uppercase Direction; preview persists records | Consume already authorized result only; no preview/select/HOLD/quote rerun |
| Stock | Assets, pole quantities, wear pools and claims are separate business records | No visual row is an inventory unit; visual read has no stock writes |
| Content | content_workspace holds current release/rights state; content_revision_records is immutable; content_outbox records releases | Reuse existing records and private release planning; explicit Avatar usage in immutable revision |
| Media | content_media_objects is existing private immutable development byte store; provider-media uses private/original and private/derivative digest keys | New table stores only derivative digest/reference metadata; no URL, credential or image bytes |
| Public media | Existing model publishing/byte serving requires current rights/release; generic Avatar rights are not inferred from model photo rights | New resolver grants no byte-serving or route access; future media serving must reauthorize |
| Staff/guest | Existing session/permissions/store/owner checks in recommendation-http, guest service and composition | No handler/auth changes; authorized loader runs before optional-error handling |
| Tests | Node test/tsx, existing isolated embedded PostgreSQL18, loopback ownership/port cleanup | Unit + real local fresh/upgrade + recommendation/auth regressions; no hosted request |

## Reconciliation of old planning documents

The old A0 latest0029 and R15 BLOCKED/Neon terms/A2-A3 hold were historical facts.
They are not current gates. R15 added0030 and completed independent final PASS before
this branch. ADR0033's presentation/business/media separation is adopted; A2/A3 is now
explicitly authorized. Renderer, booking insertion, switches, editor/upload and deployment
remain outside scope. No historical R15 failures/reviews are relabeled.

## Implementation Package v1.0 supplied during implementation

The user later supplied `ZAO_Rental_2D_Avatar_Implementation_Package_v1(1).pdf` (16 pages),
SHA-256 `1cd44ff91c8d6a25ec7d94f31fb810eef379595e4ddefa1e69991ae63e89532c`.
Read as reference data, not a replacement execution authority. Text and rendered pages
were inspected; the earlier A0 statement that the package was unavailable remains true
for that historical inspection, but no longer applies to this branch.

| Reference proposal | Reconciled implementation decision |
|---|---|
| Five visual table families / ORM mapping (pp7–11) | One constrained layer-discriminated metadata table expresses the same presentation categories, with no duplicate model/media/rights master. Existing pg/SQL retained; Prisma0. |
| male/female initial assets | Two neutral APPEARANCE_1/APPEARANCE_2 presentation identifiers; no sex/gender business classification. Both tested as synthetic metadata; no production artwork created. |
| URL or asset key | Digest + immutable revision/release references. No persistent signed/temporary URL; no image/credential field. |
| Optional candidate visual API (pp11–14) | Optional MemberRecommendation.visualization v1, original uppercase Directions and Candidate.lengthCm; no new route/automatic exposure. |
| UI canvas/boxes/dimensions/switches and pixel scaling | Phase4 renderer design, not implemented now. A2 normalized anchor/position and A3 physical ratio are available. |
| Issue creation, renderer/admin/E2E instructions (pp3–6,13–16) | Reference roadmap only, not authority to create Issues/PR/UI/deploy or run external operations. |

Exact product visuals currently apply to SKI's explicit PREMIUM ModelPromise. Boots and
wear have no such model promise in the existing contract, so they use expressly licensed
generic layers or null. This avoids presenting a selected size/possible variant as a
model guarantee. A future exact boot/wear design requires an explicit product contract.
