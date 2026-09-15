# ADR 0033 — Optional 2D/2.5D Avatar foundation, without business authority

Status: **Design adopted; A2/A3 implemented, local validation/review recorded separately.**
Base: R15 terminal `efb73933a6d3816958882205cfa3623447194625`.
Authority: [Post-R15 A2/A3](../execution/POST_R15_AVATAR_A2_A3_AUTHORITY.md).
Historical design: Avatar A0/A1 `9783373612440acef4c077b0ae23925aa467743d`.
Inspection/reference reconciliation: [repository inspection](../architecture/avatar-2d-repo-inspection.md).

## One-way presentation

Already authorized Profile/MemberRecommendation → read-only visual resolver → pure mapper
→ optional visualization v1. No reverse dependency from visual to recommendation/ranking,
availability, HOLD, quote, payment/refund, booking success, QR/custody or safety suitability.
RecommendationService.preview persists records and is never called to refresh a visual.
The existing staff/guest/session/store/owner authorization is not bypassed or replaced:
withAvatarVisualization awaits the server's authorized business loader outside its optional
failure handler. A business/auth failure rejects; only subsequent visual failure degrades.
There is no route call site, public export endpoint, new session or new permission grant.

Two appearance choices (APPEARANCE_1/APPEARANCE_2) are optional and never business sex/gender.
Layers are AVATAR, SKI, BOOT, JACKET, PANTS. 3D/WebGL-required, AR, camera/selfie, pose/body
scan, AI try-on and cloth simulation are excluded. Feature is OFF/customer-visible=false.

## Additive metadata and rights

0031 adds avatar_visuals and its constraints/index/guard;0001–0030 bytes remain unchanged.
All generic references are nullable-model/variant. Exact SKI visuals bind the complete
PREMIUM model/variant/season/actual length promise. The existing ledger keeps catalog
edition immutable; the new guard also rejects mismatched references. No master, inventory
quantity, physical asset, wear/pole count or business grant is added.

Rows store UUID, layer/appearance, exact/generic classification, optional ledger references,
existing private media digest, immutable content revision and release references, state,
stable sort and normalized anchor/position. They store no image bytes, original URL,
signed/temporary URL or credential. Existing development content_media_objects is reused
without redesigning it; no R2/provider/CMS/upload is introduced. IDs/creation time are stable;
updates advance updated_at. Soft-disable is supported; no editor/delete route is exposed.

Existing ContentRevision gains optional avatarVisualUses. This explicit purpose-specific
permission binds visual UUID, layer, appearance, match classification, model/variant/season/
length, media ID and derivative digest. Existing model photo rights alone cannot supply it.
The existing release planner hashes the whole revision including that optional field, so
new use requires a new immutable revision/release. This milestone has synthetic grants
only and supplies no write/publication API for these permissions.

A single statement reads existing current release, identical immutable revision payload,
its explicit media/use references, processed/rights-confirmed/non-internal media and current
expiry. Any stale/unreleased/retargeted/revoked/expired record is excluded, including generic
fallbacks. Restores still consult current rights. This is metadata eligibility, never a
permanent byte-serving permission: Phase4 media delivery must recheck current rights/release
at delivery using existing protected media patterns. No new image URL is made public now.

## Deterministic resolution and compatibility

Resolver chooses active rights-valid exact promise → authorized same-layer generic → null.
A partial unique index with NULLS NOT DISTINCT permits one active row per exact/generic slot;
multiple inactive records may remain. Query order is sort_order then stable UUID. Injected
ambiguous/duplicated snapshots fail closed. One SELECT covers at most three exact variants
plus six generic/body slots; no per-candidate queries or provider calls.

REGULAR uses generic reference or null, even if possible variants/model photos exist.
Missing product candidates remain null. Uppercase RECOMMENDED/SHORTER/LONGER is unchanged.
Each SKI candidate copies its original length and uses only
`skiToBodyRatio = Candidate.lengthCm / Profile.heightCm`.
Both inputs and the ratio must be positive finite. No correction, alternate size or
height−20/window/boot/age/class/rank/price recalculation is allowed. WEAR-only has no ski
ratio; SNOWBOARD has no ski visualization. Optional layers require already offered items.

MemberRecommendation.visualization is optional; absence/zero visuals/inactive/unavailable
visual DB preserves the exact original result. The mapper returns new reference-only data,
never mutates its input, uses explicit time for deterministic rights expiry and has no IO.
The required disclaimer says the visualization guarantees neither fit/safety nor stock,
model promise, booking or payment. Display labels/localization are a later UI review.

## Validation and phase boundary

Real local PostgreSQL verifies fresh0001–0031, populated0030→0031, old hashes, FK/check/default
constraints, rights/release/use denial, no PUBLIC grants, metadata-only read role and unchanged
business rows. Unit and existing recommendation/guest/staff/payment tests cover semantic
compatibility. The frozen R15 hosted runner keeps its exact30 guard and refuses the extended
plan; its numeric comparison only avoids a new TypeScript tuple-length diagnostic.
No R15 live acceptance is repeated. All self-validation and the one independent review have
separate evidence in AVATAR_FOUNDATION_STATUS.json / avatar-a2-a3/.

Stop after A2/A3. Next gate: **AVATAR PHASE 4 — CUSTOMER VISUAL RENDERER**.
No renderer, booking insertion, toggle, dressing UI, graphic scaling, visual editor, asset
upload, new PR/main merge or Production deploy is included in this milestone.
