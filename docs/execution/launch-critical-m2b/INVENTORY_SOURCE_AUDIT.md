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

| family | units | source categories |
| --- | --- | --- |
| SKI | 213 | 大人スキー 120, 子供スキー 93 |
| SNOWBOARD | 205 | 大人ボード 130, 子供ボード 70, キッズボード 5 |
| SKI_BOOT | 242 | 大人スキーブーツ 136, 子供スキーブーツ 106 |
| SNOWBOARD_BOOT | 241 | 大人ボードブーツ 143, 子供ボードブーツ 90, キッズボードブーツ 8 |
| POLE | 220 | スキーポール |
| **supported subtotal** | **1121** | |
| HELMET | 144 | ヘルメット — no model in the system |
| SNOWBOARD_BINDING | 227 | ボードバイン — no model in the system |
| **unsupported subtotal** | **371** | |

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

## The 4-in-1 pack

Three rows (`L47668600`, sizes S/M/L, quantities 32/76/36) are named
`BOARD BIND. UNITE (4 IN 1 PACK)`. Whether 残数 counts packs or individual bindings is not
stated. No multiplication or division was applied: 227 is carried as the raw source figure and
the physical unit needs vendor confirmation.

## Outputs

- `PROVISIONAL_CATALOG_MAPPING.csv` — one line per source row with its mapping and blocking reasons
- `V3_CANDIDATE_NOT_FOR_IMPORT.csv` — 76 rows, 1121 units, V3-shaped, every missing field marked `OWNER_REQUIRED_*`
- `INVENTORY_OWNER_DECISIONS.md` — what must be decided
- `ACCESSORY_MODEL_DECISION.md` — the helmet and binding gap

The candidate file **must not be staged**: its model and variant identifiers are placeholders,
and the importer would reject them.
