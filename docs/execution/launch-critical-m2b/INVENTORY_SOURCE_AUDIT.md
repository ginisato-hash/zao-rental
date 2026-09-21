# Provisional inventory source audit

Source: `【(株)Yuge 山形蔵王】新店舗投入予定明細_20260914.xlsx`
SHA256: `5ff5ce67c8ec1afbfab6bc5beeab0a2a725b73db0e1958a02860a0db39fbe1f4` (verified against the
Owner-supplied digest before anything was read).

Classification: **`OWNER_APPROVED_PROVISIONAL_INVENTORY_SOURCE`**. This is a planned-delivery
schedule, not confirmed received stock, so it is **not** registered in `real_inventory_sources`
and `REAL_DATA` stays `NOT_RUN`.

Figures below are recomputed from the file by `scripts/provisional-inventory.py`, not copied.

## Totals

86 detail rows, one destination (`391401 (株)Yuge 山形蔵王`), no shipping instruction on any
row. Summed 残数 is **1492**, which equals the total declared in the sheet's own corner cell.

| family | units | rows | Owner scope this round | source categories |
| --- | --- | --- | --- | --- |
| SKI | 213 | 18 | IN_SCOPE — one pair, one Asset | 大人スキー 120, 子供スキー 93 |
| SNOWBOARD | 205 | 12 | IN_SCOPE — board with mounted binding, one Asset | 大人ボード 130, 子供ボード 70, キッズボード 5 |
| SKI_BOOT | 242 | 19 | IN_SCOPE — left/right pair, one Asset | 大人スキーブーツ 136, 子供スキーブーツ 106 |
| SNOWBOARD_BOOT | 241 | 18 | IN_SCOPE — left/right pair, one Asset | 大人ボードブーツ 143, 子供ボードブーツ 90, キッズボードブーツ 8 |
| **IN_SCOPE_TOTAL** | **901** | **67** | | |
| POLE | 220 | 9 | EXCLUDED_BY_OWNER_SCOPE | スキーポール |
| HELMET | 144 | 4 | EXCLUDED_BY_OWNER_SCOPE | ヘルメット |
| SNOWBOARD_BINDING | 227 | 6 | EXCLUDED_BY_OWNER_SCOPE — not registered independently | ボードバイン |
| **EXCLUDED_BY_OWNER_SCOPE** | **591** | **19** | | |
| **SOURCE_RAW_TOTAL** | **1492** | **86** | | |
| WEAR_JACKET, WEAR_PANTS | — | 0 | FUTURE_INPUT_REQUIRED | absent from this source |

The excluded rows are excluded **by Owner scope**, not because they are malformed, of an
unknown family or unclassified: every one of the 86 rows is mapped, and 0 are unclassified.
The earlier split of this table into a 1121 "supported" and 371 "unsupported" subtotal is kept
below as the original raw classification, because it is the figure the first audit reported;
it is superseded as a statement of what will be registered. Helmets and bindings do additionally
have no catalogue model today, which is recorded in `ACCESSORY_MODEL_DECISION.md`, but that is
no longer their reason for exclusion.

Original raw classification, retained: supported subtotal 1121 (SKI, SNOWBOARD, SKI_BOOT,
SNOWBOARD_BOOT, POLE), unsupported subtotal 371 (HELMET 144, SNOWBOARD_BINDING 227).

The earlier working assumption of 300 board sets and 200 wear items is superseded. **This file
contains no wear at all**: there is no jacket or trouser line, so wear cannot be treated as
present on the strength of this source.

## Duplicate item codes: two different situations

Nineteen item codes appear on more than one row, and they do not mean the same thing. Treating
them alike would either lose stock or invent variants, so they are separated explicitly.

**Three are genuine split lines** — same code, same (empty) size, quantity split across rows:

| code | rows | quantities | total |
| --- | --- | --- | --- |
| `L45422000100` | 11, 12 | 1 + 9 | 10 |
| `L45422000110` | 13, 14 | 9 + 6 | 15 |
| `L45422000120` | 15, 16, 17 | 10 + 4 + 1 | 15 |

**The other sixteen are distinct sizes sharing one model code.** For example `L47949700`
appears on eight rows carrying JP sizes 23/23.5 through 30/30.5. These are separate variants
and must never be aggregated.

In both cases the original worksheet row is preserved as `source_row`, so provenance survives
and the importer's duplicate-source detection is not misled.

## Sizes

68 of 86 rows carry a JP size. The 18 that do not are all skis, where the length is instead
carried in the product name and the item code. Every one of those 18 resolved deterministically
with the name suffix and the code suffix agreeing — for example `L47923500139` with name ending
`139` yields `139 cm`. **Zero rows** needed a guess, and no supported row is left without a size.

## What the source does not contain

- **tier** — no REGULAR/PREMIUM/STANDARD anywhere. Product names such as `S/MAX` are model
  names and are not evidence of a class.
- **store allocation** — the only destination is the company, with no split between
  `MOUNTAIN_BASE` and `ONSEN_BASE`.
- **BSL** — absent. Ski boots stay `bslMm = null`, `bslStatus = UNVERIFIED`.
- **asset identifiers** — none, so per-unit identities cannot be issued yet.
- **manufacturer SKU** — the item code is retained as the model code and provenance; no new SKU
  meaning is invented, because the catalogue query treats the SKU as empty.

Brand is `SALOMON` only because every row's hierarchy begins `SAL`; this was checked across all
86 rows rather than assumed. Season is `2026/27`, taken from the `2627` token that appears in
the shipment comment on every row. Status is `UNVERIFIED`, because a delivery schedule is not
a receipt or an inspection.

## The 4-in-1 pack covers 144 of the 227, not all of them

Three rows (`L47668600`, sizes S/M/L, quantities 32/76/36 — **144**) are named
`BOARD BIND. UNITE (4 IN 1 PACK)`. The remaining **83** binding units are not 4-in-1 rows:
row 83 `BOARD BIND. THE FUTURE Black` 75, row 87 `GOODTIME XS BLACK` 4, row 88 `GOODTIME XXS` 4.
144 + 83 = 227.

Whether 残数 counts packs or individual bindings is not stated, and neither is whether a unit is
one side, a pair or a set. No multiplication or division was applied: 227 is carried as the raw
source figure. 908 (227 × 4) was never defensible, and 659 (144 × 4 + 83) is an assumption-bearing
illustration, not a quantity. None of 227, 659 or 908 is a confirmed physical quantity.

Since the Owner decision registers no binding independently, this is recorded as an open
property of the source rather than a gate on registration.

## Outputs

- `PROVISIONAL_CATALOG_MAPPING.csv` — one line per source row with its mapping and blocking reasons
- `V3_CANDIDATE_NOT_FOR_IMPORT.csv` — 67 rows, 901 units, in-scope families only, V3-shaped, every missing field marked `OWNER_REQUIRED_*`
- `INVENTORY_OWNER_DECISIONS.md` — what must be decided
- `ACCESSORY_MODEL_DECISION.md` — the binding scope decision and the corrected 144/83 split

Every source row keeps its worksheet row number, item code and raw quantity in the mapping
file, excluded rows included. Nothing is deleted from the original figures.

The candidate file **must not be staged**: its model and variant identifiers are placeholders,
and the importer would reject them.
