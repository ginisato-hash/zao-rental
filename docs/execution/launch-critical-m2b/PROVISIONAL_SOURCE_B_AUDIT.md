# Provisional booking-capacity source audit — Source B

Source: `樹林更新板25_26サロモンステーション蔵王 在庫数 (1).xlsx`
SHA256: `c85997f464e59c616c6afb18ce03a34f6a73371d1aebeba2a6b8229bfd9c2257` (Owner-supplied digest;
the workbook itself is not committed — see "What this document is not" below).

Classification: **`OWNER_APPROVED_PROVISIONAL_BOOKING_CAPACITY_SOURCE`**, count semantics
**`LOWER_BOUND_MAY_INCREASE`**. This is explicitly **not**
`CONFIRMED_REAL_INVENTORY` and is not registered in `real_inventory_sources` — it authorizes
reservation *capacity*, not a real-stock declaration. See `provisional_capacity_sources` in
migration `0041_provisional_booking_capacity.sql`.

## What this document is not

This is a transcription of Owner-supplied, already-extracted bucket totals (family × age ×
source size × quantity), not an independent re-parse of the original workbook — the raw
`.xlsx` was never read by this session. Every figure below is exactly as given by the Owner,
cross-checked only by re-summing each family/age subtotal and the combined-with-Source-A grand
totals against the Owner's own stated totals (all matched exactly — see "Arithmetic
cross-check"). This is not the same guarantee as re-deriving the numbers from the source cells
directly, and is recorded as such.

## Extraction rules the Owner applied (as stated, not independently verified)

The workbook mixes several detail-row `総計` (grand total) cells that contradict their own size
cells (examples given: SKI EXP Adult, Junior SKI, Junior SKI BOOTS). Those inconsistent
detail-row totals were **not** used as authority. The canonical extraction instead used, in
order: (1) the section subtotal row's size cells, (2) that subtotal's count, (3) a separate
right-hand "S/MAX6" table treated as its own stock block.

The S/MAX6 block (total 37) is a **separate section**, not a subset of the main/EXP section,
and both are folded into the single adult-SKI aggregate-by-length figures below (32 main/EXP +
37 S/MAX6 = 69). This document does not have a per-length split between the two sections — only
their combined per-length totals, exactly as the Owner supplied them. Recording this as an
open limitation, not a gap silently closed.

## Normalized capacity rows

See [PROVISIONAL_SOURCE_B_CAPACITY.csv](PROVISIONAL_SOURCE_B_CAPACITY.csv) — one row per
family × age × source-size bucket, 66 rows, columns: `source`, `family`, `age`, `source_size`,
`booking_size`, `size_mapping_status`, `quantity`, `unit_note`, `provenance`.

| family | adult | kids | total |
| --- | --- | --- | --- |
| SKI | 69 | 29 | 98 |
| SKI_BOOT | 36 | 33 | 69 |
| SNOWBOARD | 37 | 18 | 55 |
| SNOWBOARD_BOOT | 38 | 30 | 68 |
| WEAR_JACKET | 85 | 30 | 115 |
| WEAR_PANTS | 85 | 30 | 115 |
| **SOURCE_B_TOTAL** | | | **520** |

Wear complete-set capacity (`min(jacket, pants)` per age/size — this source has identical
jacket/pants quantity at every listed size, so set capacity equals either column): **115**
(adult 85, kids 30).

## Size handling

- **SKI / SNOWBOARD**: source sizes are already plain lengths in cm (`125 cm`…`167 cm` adult
  ski, `70 cm`…`140 cm` kids ski, `135 cm`…`165 cm` adult snowboard, `90 cm`…`130 cm` kids
  snowboard). Every row's `booking_size` equals its `source_size` — deterministic, one mapping,
  no ambiguity, `size_mapping_status = MAPPED`.
- **SKI_BOOT / SNOWBOARD_BOOT**: source sizes are `NNX` tokens (e.g. `22X`, `31X`), a format not
  used anywhere else in this codebase — Source A's boot sizes were paired JP values like
  `23/23.5` (see `INVENTORY_OWNER_DECISIONS.md` §5), a different convention entirely. No
  reviewed source-size alias exists for the `X`-token format. Per explicit Owner instruction,
  **no guess was made** about whether `X` means `.5`, a JP/US/UK/mondopoint size, or something
  else. Every boot bucket (20 rows, adult+kids, both families) is recorded
  `size_mapping_status = BOOKING_SIZE_MAPPING_REQUIRED`: its `quantity` counts toward family
  capacity totals, but it cannot be booked for a size-specific request until a reviewed mapping
  is added — see "Unresolved size buckets" below and F/`BOOKING_SIZE_MAPPING_REQUIRED` handling
  in the domain code.
- **WEAR_JACKET / WEAR_PANTS**: source sizes are standard garment sizes (`XS`…`2XL`), which are
  the catalogue's own convention already — `MAPPED`, `booking_size = source_size`.

### Unresolved size buckets (BOOKING_SIZE_MAPPING_REQUIRED)

46 units across 20 buckets (`SKI_BOOT` adult 36 + kids 33 = 69; `SNOWBOARD_BOOT` adult 38 + kids
30 = 68; combined 137 units, 20 buckets) cannot satisfy a size-specific booking request until a
reviewed `X`-token → catalogue-size alias is added. This does not invalidate the rest of the
source: `SKI`, `SNOWBOARD`, `WEAR_JACKET` and `WEAR_PANTS` (all `MAPPED`) remain independently
bookable per the domain rule that one ambiguous bucket must not block unrelated capacity.

### X-token resolution (Owner-approved, supersedes "Unresolved size buckets" above)

The Owner has since explicitly resolved the `X`-token ambiguity: **`NX` = `N` or `N.5`**, i.e. the
same shared-pair meaning as Source A's own `N/N.5` convention (§ above). This is a binding Owner
decision, not a guess by this pass — the prior "no guess was made" disposition is superseded for
this specific token format only. All 38 boot rows (`SKI_BOOT` 20, `SNOWBOARD_BOOT` 18) in
`PROVISIONAL_SOURCE_B_CAPACITY.csv` now carry `booking_size = "N/N.5"` and
`size_mapping_status = MAPPED`; `size_mapping_status = BOOKING_SIZE_MAPPING_REQUIRED` no longer
appears anywhere in this source. Because Source A's boot buckets already use the identical
`N/N.5` string for the same family/age/size, a Source B `NX` bucket and a Source A `N/N.5` bucket
for the same key pool together transparently under `provisionalCapacity()`'s existing "any
currently-ACTIVE MAPPED bucket" matching — no code change to bucket-candidate matching was
needed, only this data resolution. See `docs/execution/provisional-booking-capacity/RESULT.md`
for the corresponding RESULT entry and validated totals (MAPPED now equals RAW for every family).

## Explicitly excluded from this Owner update

| item | Source B quantity | disposition |
| --- | --- | --- |
| POLE | 74 | `EXCLUDED_BY_OWNER_SCOPE` — not added to booking capacity this round |
| SNOWBOARD_BINDING | 64 | `EXCLUDED_BY_OWNER_SCOPE` — does not create independent binding capacity; snowboard + mounted binding remains one Asset per the existing architecture |
| HELMET | 80 | `EXCLUDED_BY_OWNER_SCOPE` |

`SNOWBOARD_BINDING 64` does not mean 64 additional snowboard units — snowboard capacity from
this source is 55 boards, unchanged by the binding figure.

### SKI_SET pole-capacity dependency

The existing `SKI_SET` domain contract includes `POLE`. Since POLE is excluded from both this
Owner update and remains outside registered real/provisional capacity, `SKI_SET` reservations
depend on whatever pole capacity (real `ledger_poles` stock) already exists independent of this
source. If that existing capacity is the sole blocker for a `SKI_SET` reservation, this is
reported as `SKI_SET_POLE_CAPACITY_BLOCKER` — see the provisional-booking-capacity `RESULT.md`
for this branch's finding.

## Arithmetic cross-check

Every subtotal below was independently re-summed from the bucket rows in
`PROVISIONAL_SOURCE_B_CAPACITY.csv` (not merely copied) and matched the Owner-stated figures
exactly:

| family | Source A (existing, `INVENTORY_SOURCE_AUDIT.md`) | Source B (new, this document) | Combined |
| --- | --- | --- | --- |
| SKI | 213 | 98 | 311 |
| SNOWBOARD | 205 | 55 | 260 |
| SKI_BOOT | 242 | 69 | 311 |
| SNOWBOARD_BOOT | 241 | 68 | 309 |
| WEAR_JACKET | 0 | 115 | 115 |
| WEAR_PANTS | 0 | 115 | 115 |

Asset-backed equipment combined lower bound: `311 + 260 + 311 + 309 = 1191` physical
pairs/boards. Wear: `230` individual garments = `115` complete jacket+pants sets (never counted
as 230 sets). All of the above are exact re-sums, not restatements.
