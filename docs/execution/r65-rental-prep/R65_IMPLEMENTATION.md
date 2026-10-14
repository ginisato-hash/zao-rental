# R65 Rental Product Flow + Preparation Workbench

Local/test review candidate, based on R64 checkpoint `d299eed689e90fff4c6c03e15fbe215ab38d0d04`. Independent TD review is required before merge or any production migration/deployment. Production, Square, Vercel and provider settings were not changed.

## Customer flow

The equipment selector has exactly four entries in Japanese and English: Ski Set, Snowboard Set, Individual Items and Wear. Age/tier, the five individual families and released Premium model choices are nested within those entries. Existing price keys and amounts are reused. A manufacturer catalogue does not supply bookable stock. Premium Snowboard requires a real local released model, season and exact length variant; unpublished stock is excluded.

New submissions use `INTEGRATED_V1_3`. Saved V1.2 drafts remain readable and editable; resubmission is explicit V1.3, and confirmed historical bookings are not rewritten. Customer pole length input, validation and review centimetres are removed. Server selection uses the nearest eligible catalogue size to height × 0.7, with the shorter size winning ties. Staff sees a suggestion from the known physical pool sizes, or a 5 cm rounded starting point when none are known. Physical selection remains explicit. A tracked pole must match its assigned pool; a different length requires reassignment. An untracked SKI_SET accessory pole may use a recorded physical override. Paid standalone poles require a real eligible variant, tracked pool, availability, full-period claims and normal loan/return custody.

## Actual assigned boot and DIN

For each reservation member, the workbench joins saved recommendation body data with the actual current equipment claims. The assigned ski boot asset's `RECORDED` BSL is used directly. No common Salomon default, Mondo-to-BSL conversion or flex-based substitution is present. When binding preparation is needed and that asset has no recorded BSL, the screen requires the marking/measurement from that same boot and saves a preparation-specific physical observation tied to its asset ID. Ski-only rentals explicitly confirm the customer's own boot.

The numeric DIN reference uses height, weight, age, skier level and that actual BSL. Its fixed source/version/hash and independent observations are documented in `R65_RENTAL_UX_RESEARCH.md` and `din-source-research.json`. The owner's weight/skill range table is displayed separately. Missing/out-of-table inputs yield a pending state. Neither an advisory value nor a range is a final binding setting or a physical release-test result.

Compatibility, physical binding adjustment/checks and equipment confirmation are separate confirmations. Snowboard preparation has no ski BSL or DIN controls. Optional wear must also be confirmed. The reservation contact supplies the booking name; existing member keys are displayed as person numbers because the booking contract has no separate per-person name field.

## Preparation authority

`CustodyService.prepare()` persists `ZAO_PREP_V2` in the existing `rental_preparations.fit_evidence` JSONB. Staff identity/time, body profile, selected equipment, BSL source, reference value/provenance, pole selection and physical confirmations are server-recorded. Clients cannot assert a calculated DIN or actor. Idempotency and optimistic versions remain enforced.

The record also binds the current hold conditions, so product, wear, period or assignment changes invalidate it. Actual boot replacement, BSL changes and physical pole mismatches invalidate ready status and checkout. A fresh preparation replaces the current evidence under a new version; the existing request journal retains prior mutation results. Historical evidence remains readable under its original contract.

The tomorrow manifest derives the next Tokyo calendar day from the server clock, current store, confirmed/paid/active reservations and BOOKING_VIEW plus RENTAL_CHECKOUT. Cancelled, unpaid, wrong-store, transfer-attention and already-issued records are excluded. Ready means a recorded preparation, current evidence and fixed preparation stage. The next day's ordinary manifest retains that state.

## Migration and privileges

0057 is necessary for a durable pole absence witness with an empty variant list. Only V1.3 SKI_SET accessory poles with no eligible registered pole size can create such a witness; no inventory is fabricated. The custody stage guard counts every required serialized loan while excluding only a V1.3 SKI_SET accessory pole with a matching store, variant list and full-period exemption witness. It grants the existing custody executor read access to that witness. No new prepared table and no historical booking rewrite are introduced.

Local roles receive read access to saved recommendation profiles and column-scoped preparation updates. Corresponding production role-plan statements and a source checksum pin are review artifacts only; they were not applied to a production database. The 0057 pin does not represent TD acceptance or authorization to deploy.

## Evidence and test boundaries

The evidence archive includes full command receipts/logs, JA/EN captures at 390 and 1440 pixels, source diff and research provenance. Staff EN screenshots capture the new bilingual workbench/tomorrow component; the surrounding existing staff navigation remains Japanese. The ordinary day-of home card is additionally captured in Japanese, with the day-of workbench captured in both languages.

All UI data and provider outcomes are fixtures. `Mountain Board` and `Rental Ski Boots` are display names for synthetic test stock. One exact fictional contact alias is converted at the test boundary so production-copy images do not expose synthetic/debug wording; normal runtime contact validation is unchanged. No real customer, real provider payment or physical binding test is claimed by these fixtures.

New behavioral coverage includes no-pole-catalog booking through custody-role checkout, five individual products, Regular and released Premium snowboard, exact model/season/length preservation, wrong authority rejection, missing physical checks, actual BSL 304 → 314 with DIN 4.5 → 4, stale preparation rejection, duplicate prepare, permission/store exclusions and next-day ready persistence. Existing regression commands remain included in `verify`.

The full regression evidence retains all command attempts and their log checksums. The final pass status is the latest successful result of each required command, including targeted reruns after corrections; it is not represented as one uninterrupted `npm run verify` invocation. Historical migration installer tests preserve their exact 0053/0055/0056 registry prefixes, then restore the current local fixture for current-schema checks. Frozen production installers remain unchanged. Existing ledger/avatar UI tests open technical details and use the human-facing labels introduced in R64.

## TD correction candidate (parent d3f8ed3)

The initial R65 review failed on standalone pole custody and item-specific inputs. The correction keeps the same branch and Draft PR; the earlier evidence remains historical.

| V1.3 product | Required profile in addition to age category | Explicit null fields |
| --- | --- | --- |
| SKI only | height, integer weight, age, skier level | footCm |
| SKI_BOOT only | foot size | heightCm, ski |
| POLE only | height | footCm, ski |
| SNOWBOARD only | height | footCm, ski |
| SNOWBOARD_BOOT only | foot size | heightCm, ski |

Sets retain their existing inputs. V1.2 retains numeric weight and its saved pole shape. V1.3 ski weight is an integer within the existing 5–300 kg bounds; no rounding or manual DIN override is introduced. The read-only Production audit found zero decimal profiles across 6 saved recommendation profiles and 5 draft profiles (3 bookings, 0 preparations). Its aggregate-only SQL/result is in `CORRECTION_PRODUCTION_READBACK.json`; Production remains at migration 0056 (56 migrations).

Only SKI_SET accessory POLE requirements may be exempt in allocation, payment claim validation, preparation completeness and migration 0057. Empty variants are valid only for V1.3 SKI_SET accessory poles. Standalone poles have no fallback exemption: no catalogue or no tracked pool yields no offer, quote, booking or payment. Local PostgreSQL proves the tracked path through exactly one POLE loan, return scan, receipt and inspection. Existing pickup-date guards remain intact.

The customer menu disables standalone poles when the selected store/age has no available registered pool. The server still checks actual period capacity. Premium is disabled with “Premium（現在受付停止）” / “Premium — currently unavailable” when the selected sport has no released model. The existing exact model/season/variant promise gates remain authoritative.

BSL and DIN are readiness requirements only for binding work. Ski boots alone can be prepared with null BSL and no DIN; actual asset identity, size and physical equipment confirmation remain required. Optional BSL observations retain the actual-asset binding. Staff single-item display omits the internal REGULAR tier.

The correction adds day-of pole custody, unavailable-pole rejection, every item's minimal input contract, V1.3 integer/V1.2 decimal compatibility, null-BSL boot preparation, JA/EN required/hidden fields, Premium unavailable/released states and audit assertions. All data/provider results in these tests are synthetic. No Production migration, deploy, provider write, merge or PR-ready transition is authorized by this candidate.

Correction validation: all 77 required local commands have a final PASS, including all 1121 unit tests, real PostgreSQL and JA/EN browser tests. The 98 correction captures cover 390/1440-pixel layouts. `correction-validation-receipts.json` retains every recorded attempt and identifies each command's latest result. The initial regression run exposed the old standalone-pole success expectation and decimal-weight UI expectation; these tests now require refusal. An added projection unit case was corrected to remove its unrelated wear fixture. Mac boundary testing passes with its fixture in an isolated cache directory outside managed writable temporary roots; controller code and protection policy are unchanged. Test-regenerated historical artifacts were archived separately and restored, leaving historical evidence intact.

## TD final correction candidate (parent 22a7c77)

Claude took over as sole implementer in the same worktree, branch and Draft PR #64 (Issue #47 comment 6161525102). The worktree was clean at `22a7c77`; no Codex work in progress existed. The accepted `22a7c77` behavior is preserved. Sections above remain the historical record; where they mention a skier level, a default value or legacy preparation validity, this section supersedes them.

**No plausible defaults.** A new guest profile starts with height, foot size, weight, age and skier type unset. Product and Adult/Child changes clear or keep values but never inject numbers. An emptied numeric field stays unset. The step cannot proceed and nothing is saved until the guest enters every value the item needs. The server requires the V1.3 values explicitly and refuses null/missing values and the retired synthetic default (generic `BEGINNER` level, no skier type). The draft-scoped reload cache accepts only the new nullable shape.

**Explicit DIN skier type.** V1.3 Ski Set and Ski only require `skierType` (`TYPE_I` / `TYPE_II` / `TYPE_III`), chosen by the guest from behavior-based ISO 11088 wording. The DIN reference uses only that declaration. V1.3 forbids the generic `level`. V1.2 keeps its saved `level` readable and cannot carry a skier type. Nothing maps a level to a type. A historical profile without a declared type shows “申告なし / Not declared”, has no DIN reference and cannot be marked ready (`SKIER_TYPE_DECLARATION_REQUIRED`). There is no technician override. Such a booking needs the guest to re-confirm the declaration; no in-app path for that is added in this candidate. Actual assigned-boot BSL authority, compatibility, physical adjustment and release checks are unchanged.

**Legacy preparation.** Non-`ZAO_PREP_V2` evidence is never `preparationValid`. Checkout refuses it with `REPREPARATION_REQUIRED`. Staff see “再準備が必要 / Re-preparation required” with an explanation, and the tomorrow/day-of manifest does not count it as prepared. V2 re-preparation through the normal path restores checkout. The previous record stays in the append-only `rental_history` (`before_data`). Production has zero preparation rows, so no data rewrite is needed.

**Primary DIN surface.** The weight/skill range is removed from the workbench and from code. The single primary number is the actual assigned-boot BSL advisory. Source, version and access date stay under “参考値の出典 / Reference source”.

**Standalone Pole (UI-01).** The Size step shows only the price and “身長に合わせてご用意します / Prepared to suit your height”, with no radio or length input. The final review shows the same text. The guest sends no direction for a standalone pole. The server derives `RECOMMENDED`, the only candidate it offers, and refuses `SHORTER`/`LONGER`. Mixed groups keep candidate choice for the other members.

**Unsaved note (UI-02).** The routine-edit status becomes a small note: “入力内容は「候補と参考料金を確認」で保存されます。”. The leave confirmation, `beforeunload`, draft-scoped recovery and contract synchronization are unchanged and remain covered by the existing Back/Forward/header/language/close regressions.

**Item ID (UI-03).** Printed asset labels carry the full asset UUID (`AssetLabelSheet`), so the short reference is an operational identifier. It is shown as “管理番号 / Item ID”, secondary to family, size and model. Pole pool references move to Technical details. Staff visual fixtures use distinct synthetic asset IDs.

**Validation.** All 77 local `verify` steps have a final PASS, including 1126 unit tests, real PostgreSQL and JA/EN browser suites. `final-validation-receipts.json` keeps every attempt. In the first full batch, `test:controller:macos` lacked the `codex` binary on PATH (the test only hashes it), and `test:custody-ui` failed by design (see below). Both passed on rerun. The customer and staff captures at 390/1440 were regenerated and inspected visually: untouched/rejected Ski, skier-type entry, standalone and mixed Pole Size/review, DIN card, legacy re-preparation, boots-only.

**Residual for TD.** The staff recommendation preview tool (`/staff/recommendations`, `RecommendationWorkspace`) still creates V1.2 profiles with a generic level. Ski bookings made there now correctly fail closed at preparation (“申告なし”). Adding a skier-type declaration to that tool is outside the four authorized items and is left for a TD decision. `tests/custody/normal-ui.ts` asserts the fail-closed state, then records an explicit declaration on its synthetic preview at the test boundary before continuing custody.
