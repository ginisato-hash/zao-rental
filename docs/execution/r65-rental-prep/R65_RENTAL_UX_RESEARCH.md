# R65 research notes — accessed 2026-10-14 JST

- https://www.wintersteiger.com/rent-service/en/product-solutions/software/easyrent-software : Easyrent coordinates customer, equipment and booking information; Easyreservation supports advance online reservations; Easygate directs equipment issue. Adopt data reuse and task ordering; do not implement integrations, queue monitors or copy code.
- https://www.wintersteiger.com/nl/Bedrijf/Nieuws/Nieuwtjes/351-WINTERSTEIGER-at-ISPO-2019-Welcome-to-the-future : Sizefit Caliper measures boot data for Easyrent. Adopt actual boot measurement as authority, not Mondo inference. No hardware integration.
- https://www.wintersteiger.cn/zh/%E9%9B%86%E5%9B%A2%E5%85%AC%E5%8F%B8/%E6%96%B0%E9%97%BB/%E6%9C%80%E6%96%B0%E6%96%B0%E9%97%BB/190-New-WINTERSTEIGER-products-at-ISPO-Focus-on-comfort-and-safety : Safetronic adjustment/testing hardware is distinct from software data handling. Keep professional physical check separate from DIN advice; do not claim machine test/certification.
- https://www.powder7.com/ski-bindings-din-chart/sizing-guide : Owner-provided UX comparison only; not numerical authority, runtime scrape or copied HTML.
- https://www.salomon.com/en-gb/sg/a/how-to-choose-ski-bindings : body profile and actual BSL affect DIN; professional fit/adjustment remains required.
- https://www.salomon.com/en-gb/lp/g/ski-boot-and-binding-compatibility : official Salomon link to ISOSKI. Boot/binding compatibility is separately checked, including GripWalk.
- https://isoski.lumiplan.pro/ : public UI independent sanity checks in din-source-research.json; simulated profile only. No proprietary JS or runtime integration copied.
- https://www.iso.org/standard/71249.html : published ISO13993:2019 rental shop sampling/inspection, under15days; applies to app's maximum10day context. Draft successor not treated as published.
- https://www.iso.org/standard/84084.html : published ISO11088:2023 assembly/adjustment/inspection for owned or15+day hire. Does not replace short-rental shop quality-control obligations.
- https://www.unionsportcycle.com/les-actualites/2022-12-14/tableau-de-reglage-des-fixations-de-ski-alpin-la-norme-iso-11088 : freely downloadable official functional DIN table, version2022. Reproducible PDF SHA256 and independently entered numerical facts in din-source-research.json. No PDF/prose/layout redistribution. Use version explicitly, not a claim of full ISO2023/2026 shop compliance. Blank cells fail closed.

Owner model steering: S/PRO DELTA R80 W GW L47944000 is a possible actual model, not a universal default. Inventory audit also includes SENSE RT GW L47949700 and kids. Do not overwrite these with Delta. Actual assigned asset bsl_mm/bsl_status, or authenticated physical observation tied to that same asset, is authoritative.

- https://www.salomon.com/en-gb/sg/a/how-to-choose-your-ski-poles : choose by height and confirm physically with elbow near90degrees. The exact height×0.7 starting rule comes from the explicit Owner R65 instruction. Nearest known size and lower-size tie are local deterministic advisory policy, not a claim from Salomon.


## Fixed numerical reference and actual-boot decision (2026-10-14)

The active numeric initial-reference version is `USC_2022_INITIAL_V1`, using functional numerical facts in Union Sport & Cycle’s published 2022 alpine adjustment table. Source: https://www.unionsportcycle.com/les-actualites/2022-12-14/tableau-de-reglage-des-fixations-de-ski-alpin-la-norme-iso-11088 (accessed 2026-10-14). Source PDF SHA-256: `7e3c983c4189b85d9a294737c2208cf2dae4a3fcca208cdfcf6e6dc008567ac4`. The copyrighted PDF, artwork, prose and layout are not redistributed. Only numerical facts and independently written lookup logic are implemented. This is an initial staff advisory, not a claim of complete ISO compliance or current-season manufacturer approval.

Use the upper row of weight and height codes, advance by 0/1/2 rows for beginner/intermediate/advanced, then move up one row for age ≤10 or ≥50. Columns are actual whole-mm boot sole lengths ≤230, 231–250, 251–270, 271–290, 291–310, 311–330, 331–350, ≥351. Missing cells, age underflow and fractional kg falling between the published integer bands produce no number; do not round upward, extrapolate or borrow the nearest nonempty cell. No optional percentage increase is implemented.

Independent public-UI checks at https://isoski.lumiplan.pro/ (linked by Salomon’s compatibility guidance), using fictional inputs only, returned: 170 cm / 60 kg / age 30 / beginner / 304 mm → 4.5; the same with 314 mm → 4; intermediate / 314 mm → 5; advanced / 314 mm → 6; age 50 / advanced / 314 mm → 5. No calculator code was extracted and no remote calculator is used at runtime. These are regression cases, not final shop adjustment approval.

The owner’s latest instruction explicitly replaces the earlier shared-model proposal: always use the ski boot asset assigned to that individual customer. `RECORDED` asset `bsl_mm` takes priority. If missing, record the physical boot marking/measurement in that preparation only, tied to `bootAssetId` and server-authenticated staff/time. The inventory spreadsheet contains S/PRO DELTA R80 W GW and SENSE RT GW as different stock lines; do not substitute one for the other. No Mondo-size inference or global Salomon BSL default is implemented. A changed assigned boot invalidates the prior evidence. Ski-only customers’ own boots require an explicit physical observation; a rented boot must use its actual asset identity.

The owner-supplied weight/skill range image is a broad comparison reference and cannot determine one value for an actual BSL. The actual-boot numeric reference above is authoritative for the app’s advisory. Physical boot/binding compatibility and professional adjustment/release checks remain separately required before marking a ski rental ready.

## Contract and completion boundaries

New guest submissions emit `INTEGRATED_V1_3`; historical V1.2 remains readable. Only V1.3 POLE items may have an empty variant list when no real pole catalogue entry exists. This retains the structural ski set without inventing inventory and preserves the existing nonblocking pole protection witness. Individual item prices are selected through the existing productKey function. Premium boards require a released model/season and exact length variant; manufacturer catalogue entries do not become shop stock.

Every new prepare call requires `ZAO_PREP_V2`. Existing JSON evidence is retained for historical reads. Current preparation evidence is checked against the actual current assignment before checkout; a replacement or changed BSL requires fresh physical confirmation. New prepare records are stored in the existing JSONB column, with the original top-level selections retained for custody triggers. No new table is required. Migration 0057 is necessary because the existing pole-exemption witness requires a nonempty variant array; it now permits an empty witness only for V1.3 with no eligible catalogue pole variant. No existing bookings are migrated. This migration is local/test only; scoped column grants are added only to local provisioning and the unapplied production role plan.

The tomorrow queue uses the server’s Tokyo calendar and both BOOKING_VIEW and RENTAL_CHECKOUT permissions. It excludes unpaid, cancelled, invalid-state and transfer-attention bookings, wrong stores and already checked-out bookings. It is a read-only projection of existing bookings and preparation state, not a new booking state.

proprietary source code copied = 0

Migration 0057 also fixes the custody-role stage guard for a V1.3 pole with a full-period absence witness: such a pole has physical preparation evidence but no serialized loan row. All other equipment still requires its loan. The migration is pinned in the source manifest for deterministic no-write plan regression; this candidate pin is not a Production application or TD acceptance. No production installer was executed.
