# R67_BOOKABLE_RENTAL_REPAIR — candidate record

Authority: Issue #47 TD plan 6193538884, design addendum 6193738293, plus Owner directions given in the
implementation session on 2026-10-15 (listed below; they supersede the plan where stated).

## Owner directions applied (supersede the TD plan where they differ)

| # | Direction | Effect |
|---|---|---|
| O1 | Premium models are **not yet confirmed by Salomon**. Every Source A row — incl. `S/MAX 4`, `WILD CARD`, `LIBERTY` — is **Regular** stock per the inventory sheet (ski and snowboard). | The activation binds **no** Premium model. The model-bound Premium mechanism (0058 bindings, planner, DB guards) ships and is proven on a test-only synthetic source; Premium is shown as `COMING SOON` and is not selectable until a confirmed Premium source + binding is registered. Plan items #11–#13 (WILD CARD / LIBERTY / S/MAX 4 Premium) are therefore **not activated**. |
| O2 | No model names in the Premium display. | Premium tiles/page show category, price and `MODEL / SEASON / LENGTH` only. |
| O3 | Header context marker reads `BOOKING` on every page. | Supersedes addendum §1 (`RENTAL` on browsing pages). |
| O4 | Remove the `SKI / SNOWBOARD / WEAR · ZAO ONSEN` line under RENTAL. | Removed (home + rental). |
| O5 | Regular snowboard image = a lower-priced official board; Premium snowboard = riding photo of a graphic high-grade board. | REFLECT product image (Regular); HUCK KNIFE PRO riding photograph (Premium). See ASSETS.md. |

## Migration 0058 (additive; 0001–0057 untouched, 0057 never re-run)

- `provisional_size_key(family,size)` canonical comparison boundary (lengths `NNN cm`; boots `lo cm` / `lo/hi cm`; others trimmed). Source strings are never rewritten.
- `provisional_capacity_buckets` family CHECK adds `POLE`.
- `ledger_models.catalog_role` (`PHYSICAL` default | `PROVISIONAL_BOOKING_SELECTOR`).
- `provisional_model_bindings` (immutable; guard: PREMIUM SKI/SNOWBOARD variant, same family/age/canonical size, quantity ≤ bucket) and `provisional_capacity_claims.promise_variant_id` with a per-binding/day guard. The existing per-bucket guard keeps Regular + Premium single-counted.
- 0054 receipt trigger/claim guard re-created with canonical comparison (otherwise unchanged).
- 0057 `inventory_sync_pole_exemptions` re-created accepting V1.4 and the Regular pole fit pool for Premium sets.
- `provisional_premium_catalog()` SECURITY DEFINER catalog read (identity only, no quantities).
- Data-driven `GRANT SELECT ON provisional_model_bindings` to roles that already read buckets.
- Proven owner-applicable on the Neon-shaped topology: `tests/operations/production-0057-owner-apply.ts` (registry 57→58, guard/roles/memberships/LOGIN unchanged, new objects owner-owned).

## Production DB delta plan (for TD direction; nothing has been applied)

1. Snapshot: registry `57 / 0057`; counts of variants/assets/poles/buckets/claims/bookings/payments; Source A/B effective quantities.
2. Apply canonical 0058 exactly once as `neondb_owner` (one transaction, advisory locks 71820401/71820600, `foundation_migrations` EXCLUSIVE).
3. `node --import tsx scripts/r67-catalog-activate.ts plan` (rollback dry run) → review → `apply` exactly once.
4. Expected activation delta (from the accepted Source A/B payloads; identical in the local preview and real-PG test):
   - supplemental POLE source `9d219847…f603` (adult 110/115/120/125/130 cm = 30/30/30/20/10);
   - 5 `PROVISIONAL_BOOKING_SELECTOR` models (Regular SKI, SNOWBOARD, SKI_BOOT, SNOWBOARD_BOOT, POLE);
   - 99 Regular variants: SKI 19, SNOWBOARD 12, SKI_BOOT 27, SNOWBOARD_BOOT 36, POLE 5;
   - Premium models 0, bindings 0 (O1);
   - ledger_assets / ledger_poles / WEAR variants / Source A+B quantities / bookings / claims: unchanged (operator invariants).
5. Read back the invariants; deploy the exact merged source; protected smoke (Regular Ski / Regular Snowboard reach candidates + estimate; Premium shows COMING SOON); no payment submission.

## Functional changes

- Catalog bridge: recommendation reads the generic Regular variants; provisional planner matches canonical sizes; physical handoff stays blocked (`PROVISIONAL_PHYSICAL_ASSIGNMENT_REQUIRED`).
- Boots: target = foot + 1.0 cm; nearest bucket within 1.0 cm; equal distance never chooses the smaller size; shared shells (`25/25.5`) usable; up to three boot fallbacks when a bucket is full. Policy copy shown in JA/EN.
- POLE: bookable individual item from provisional capacity; SKI_SET accessory pole keeps the V1.3 behaviour.
- V1.4 contract: `items[]` (multiple individual items of one sport, priced per item from approved keys, no bundle) and `startAt` / `returnBy` period boundaries (slot derived server-side, legacy V1.3 readable).
- Pricing composition from explicit cells only: same-day AM/PM/DAY_1; multi-day `HALF_DAY_PM + DAY_n + HALF_DAY_AM`; advance 5% after the composed subtotal; components persisted per line.
- Premium (mechanism): a model promise consumes only its bound bucket(s) and never more than the binding quantity; Regular + Premium share one bucket ceiling. A Premium set's boots/poles use Premium variants of that family when any exist (physical custody tier guard unchanged), otherwise the common Regular fit pool.

## Validation (local)

- Real PostgreSQL R67 matrix `tests/readiness/r67-bookable.ts` (`npm run test:r67-bookable`, added to verify/CI): 20/20.
- Period/pricing + size units `tests/unit/r67-period-size.test.ts`; unit suite 1135/1135.
- Visual self-check `tests/r67/shoot.ts` / `tests/r67/flow-shots.ts` against the local preview (`tests/r67/preview.ts`): logo image, no FAMILY, no radius/shadow, no overflow, BOOK + index in the first viewport (home/rental) at 390/1440.
