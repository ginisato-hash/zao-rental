# Stock import template (V3)

`docs/execution/launch-critical-m2a/stock-import-template.csv` holds the canonical header.
The importer is the one built in M1: there is no second import path, and nothing here
guesses a value. A row that cannot be resolved exactly is reported and blocks the commit
until the source file is corrected.

## Columns

| column | required | meaning |
| --- | --- | --- |
| `source_kind` | yes | `SHOP_RECEIPT` for real stock. `MANUFACTURER` is catalogue material and is never stock. |
| `intent` | yes | `ADD`. `REPLACE` and `UNKNOWN` need an explicit owner decision and are refused. |
| `model_id` | yes | Catalogue model id. Must exist. |
| `season` | yes | `YYYY/YY`, matched exactly against the catalogue. |
| `variant_id` | yes | Catalogue variant id. Model, season, size and class must all agree. |
| `manufacturer_sku` | no | Empty when the authoritative catalogue holds no SKU. |
| `quantity` | yes | Whole number. For asset rows it must equal the number of `asset_ids`. |
| `unit` | yes | `ASSET_PAIR`, `ASSET_BOARD`, `PAIR_QUANTITY` or `PIECE_QUANTITY`; derived from the family and checked. |
| `asset_ids` | asset rows | `|`-separated UUIDs, one per physical item. Empty for quantity stock. |
| `store_id` | yes | `MOUNTAIN_BASE` or `ONSEN_BASE`. |
| `source_document` | yes | Receipt identifier. The file digest is recorded separately and automatically. |
| `source_row` | yes | Row reference inside that receipt. Used for provenance and duplicate detection. |
| `category` | yes | `SKI`, `SNOWBOARD`, `SKI_BOOT`, `SNOWBOARD_BOOT`, `POLE`, `WEAR_JACKET`, `WEAR_PANTS`. |
| `size` | yes | Exactly as the catalogue records it. |
| `tier` | yes | `REGULAR`, `PREMIUM`, or `STANDARD` for wear. |
| `bsl_mm` | no | Ski boots only. **Leave empty when unknown** — it is never inferred. |
| `status` | yes | `UNVERIFIED`, `AVAILABLE`, `MAINTENANCE` or `RETIRED`. |
| `manufacturer` | no | Brand, matched exactly against the catalogue. |
| `model_name` | no | Model name, matched exactly against the catalogue. |
| `note` | no | Short internal equipment note. **Never customer information.** |

V2 files (without the last three columns) are still accepted.

## Counting rule

One ski **pair** is one Asset. One snowboard is one Asset. One boot **pair** is one Asset.
Poles are a pair quantity with no per-item identifier and no QR label. Wear keeps its
existing quantity model.

## Procedure

1. **Dry run.** Upload the file. Nothing is written. The report counts total rows, valid,
   warning, blocking errors, duplicate identifiers, duplicate sources, existing conflicts,
   unknown store, unknown category, invalid quantity, unresolved model, unresolved BSL,
   malformed rows, would-create, would-update and no-ops.
2. **Fix the source file** until `blockingError` is zero. Do not edit data to make it pass.
3. **Commit** with the stage hash from that dry run. A stale or altered plan is refused, so
   a commit can only apply the plan that was actually reviewed.
4. **Re-uploading the same file is safe.** Already-imported rows are reported as no-ops and
   create nothing; immutable asset identifiers cannot be duplicated.
