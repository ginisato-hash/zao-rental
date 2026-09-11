# Current ledger contract — owner-authorized 2026-09-11

This is the narrow current overlay on the immutable bootstrap references. It records the owner's
new supervised scope, not an execution approval for the Runner or any deployment. PR #3 stays held.

| Concept | Contract implemented here |
|---|---|
| Product model | Named model/brand and family, separate from sizes and sellable bundles |
| Variant | Model + explicit family, ADULT/KIDS, REGULAR/PREMIUM and size label including unit |
| Physical Asset | One ski pair, one snowboard, or one boot pair; opaque immutable UUID |
| Labels | Current owner decision: ski and both boot families use two identical QR labels per single Asset; see RETURN_RULES.md for E12 follow-up |
| Pole quantity | Variant + store + physical state, integer PAIR count; one pair is two poles |
| Bundle | Ski + ski boots + poles, or snowboard + snowboard boots; all one component unit; no stock creation |
| Custody | Explicit initial store + immutable initial history; basic update cannot relocate an Asset/pool |
| BSL | Ski boot UNVERIFIED/null or RECORDED mm + evidence; other families NOT_APPLICABLE/null |
| Ledger count | Physical records/quantity only, never period availability or permission to lend |

ADULT/KIDS carry the approved 13+ / under-13 business meaning, but renter birthdate/timezone evaluation
is not implemented by this ledger. No age/tier substitution exists. Immutable variants require a
future reviewed correction workflow for a mistaken size/category; this PR does not silently rewrite
the identity of already registered physical stock. Basic updates include model name/brand/notes,
variant notes, Asset status/notes/explicit BSL, pole quantity/status/notes, and bundle name/notes.
A DB-generated size identity key folds ASCII case and whitespace, so `160 cm`, `160CM` and
`160 Cm` cannot be separate variants of the same model/age/tier. Size filtering uses this same key.
The entered label is retained; this is lexical normalization, not automatic numeric/unit conversion,
shoe-size equivalence or fit calculation. Different unit systems/semantic labels and correction of
mistaken sizes still require the future reviewed intake/correction workflow.
Every update requires expected version and reason. Sales remain disabled; physical status alone
does not certify safety, binding fit or date/store availability.

## Current stock assumptions and provenance

- Planned ski plus snowboard total: approximately 300 sets combined, not 300 each or 250 each.
- Planned wear total: approximately 200 items. Top/bottom management unit, pricing and booking
  allocation are unresolved; a sales-simulation assumption is not an operational decision.
- No confirmed 300-individual/200-wear master exists in this delivery. No legacy workbook or sales
  PDF was imported. Old workbook totals in INVENTORY_SAMPLE.md remain reference-only; no claim
  about inconsistent totals, additions versus replacement or current stock is silently resolved.
- `tests/fixtures/ledger-sample.ts` is hand-authored SYNTHETIC data: six models (including a catalog-only
  wear kind), eight variants, six Assets (three ski pairs + one board + two boot pairs), two pole
  pools (6 + 4 pairs), and two bundle definitions. IDs, model names, sizes and store allocations are
  test placeholders. Initially all ski-boot BSL values are unknown; an explicitly synthetic test
  simulates recording a measured marking. No actual boot measurement is asserted.
- Provenance uniqueness is per resource: `(resource, sourceDocument, sourceLocator)`. A single
  inventory-sheet row may supply both a model description and an Asset record; this is accepted,
  while a second record of the same resource citing that row is rejected. Detail/history preserve
  the resource and citation. This is not global cross-table deduplication or proof of physical identity.
- Each row retains source document and object locator. An import checksum and advisory lock make
  replay atomic/idempotent; changed source content is stopped rather than treated as replacement.
- Production registration can hold UNVERIFIED intake references; SYNTHETIC stays explicit and immutable.
  No bulk 300-set load fixture is created. Any future scale fixture must remain marked synthetic.

## API and authorization

`GET /api/ledger/{models|variants|assets|poles|bundles}` lists up to 100 records with explicit total
and offset. Filters: storeId, sport, age, tier, size, status, q. Filters never silently widen across
categories. `GET .../{uuid}` returns detail, audit history and initial Asset location history.
POST registers; PATCH requires version/reason and mutable fields only. No DELETE or movement route.
JSON Schema rejects extra fields, identifiers, auth flags, implied availability and unapproved inputs.
Asset/pole update locks include the store scope in the locking SQL itself; a forbidden store row
is rejected without acquiring its row lock. UI detail/save responses carry a selection generation;
late results cannot restore an old tab or overwrite a newer selection. This discards stale display
responses, not an already-submitted database mutation, and never automatically retries a write.
Writes enforce JSON/body-size and same-origin checks in addition to server authorization. E05 must
review deployed origin/proxy/session/CSRF configuration before connecting actual users or a DB.

All production requests currently fail closed without a verified session. Authorized API/service
operations have real-Postgres test evidence only. UI uses separate test data/transport and never
claims that staff login or browser-to-DB production integration is complete.

## Evidence and remaining tasks

Real DB checks cover duplicate UUID/source row, FK/family integrity, paired labels, stock-independent
set definitions, nonnegative integer pole pairs, sample replay/drift, BSL unknown/recorded/NA,
immutable custody/identity/category, scoped role refusal, HTTP create/reload/update, concurrent
version conflict, append-only history and 0002 failure recovery preserving 0001 data.
Unit/schema checks and production-denial/component E2E complement these, not replace them.
Exact command exits, head/CI and static review are attached to the new Draft PR.

Next E05: select/provision maintained identity provider, verified server sessions with store scope,
runtime DB connection and least-privilege roles, session revocation, deployed CSRF/origin checks.
Next E03 remainder/E06: explicit time/money golden cases and continuous multi-component period/store
allocation before any HOLD or available-count claim. Transfers, actual inventory reconciliation,
wear units, label printing, DIN/fit, payment and rental operations remain separate tasks.
