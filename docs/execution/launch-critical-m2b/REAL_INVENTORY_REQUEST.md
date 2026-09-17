# Real inventory: what is needed before import

`REAL_INVENTORY_FILE_REQUIRED`. No inventory file is present, so the real import cannot run.
This is what the import needs, and why. Nothing is guessed: a value that cannot be resolved
exactly blocks its row until the source file is corrected.

The template is `stock-import-template.csv` (header V3, identical to the M2A canonical one).

## 1. The catalogue must exist first

Every row is matched against the catalogue by `model_id`, `season`, `variant_id`,
`manufacturer_sku`, `size` and `tier` **exactly**. A row whose model or variant is not
already registered is reported `EXACT_CATALOG_MAPPING_REQUIRED` and cannot be committed.

So before the stock file is useful, the catalogue needs, per product:

- brand (manufacturer) and model name
- family: `SKI`, `SNOWBOARD`, `SKI_BOOT`, `SNOWBOARD_BOOT`, `POLE`, `WEAR_JACKET`, `WEAR_PANTS`
- catalogue season in `YYYY/YY`
- each size actually held, written exactly as it will appear in the stock file (`160 cm`, `26.5 cm`, `M`)
- class: `REGULAR`, `PREMIUM`, or `STANDARD` for wear
- age band: adult or kids

If a catalogue export already exists in another form, send it as-is and it will be mapped —
but the mapping decisions are the Owner's, not inferred here.

## 2. The stock file itself

One row per (product, store, unit kind). Columns are described in
`../launch-critical-m2a/STOCK_IMPORT.md`; the ones that most often need a decision:

- **`asset_ids`** — one UUID per physical item, `|` separated, and `quantity` must equal how
  many there are. These become the permanent identity printed on the label. If the shop has
  no existing identifiers, they can be generated, but they must then be fixed forever.
- **`quantity`** — for poles and wear this is the count; there are no per-item identifiers.
- **`bsl_mm`** — ski boots only. **Leave empty when unknown.** It is never inferred, and an
  empty value is recorded as unverified rather than wrong.
- **`status`** — `AVAILABLE` for rentable stock, `UNVERIFIED` when it still needs checking,
  `MAINTENANCE` or `RETIRED` otherwise.
- **`store_id`** — `MOUNTAIN_BASE` or `ONSEN_BASE`. Both stores must appear before the launch
  gate can report real data as ready.
- **`source_document` / `source_row`** — which receipt or sheet each row came from. This is
  the provenance that makes a re-import safe, so it must be stable.
- **`note`** — optional internal equipment remark. Never customer information.

## Counting rule

One ski **pair** is one Asset. One snowboard is one Asset. One boot **pair** is one Asset.
Poles are a pair quantity with no individual QR. Wear keeps its quantity model.

## 3. Owner approval of the file

Committing an import does not make it real stock. The file's SHA256 must be registered in the
approved source register, which sits at the deployment boundary: importing staff cannot
approve their own file. Send the file and it will be hashed independently; the digest is then
approved once, deliberately.

## 4. What happens next

1. dry run — nothing is written, and a report counts valid, warning, blocking and no-op rows
2. corrections in the **source file** until blocking errors are zero
3. explicit commit against the reviewed plan
4. real-data acceptance against the approved digest, with store coverage derived from the
   committed rows
5. reconciliation, then a small label sample before any bulk printing

## Also still needed from the Owner

- the Production database provider, its region, and any plan decision
- Square Production credentials and the expected identity: merchant ID, `MOUNTAIN_BASE` and
  `ONSEN_BASE` location IDs, webhook origin and path
- the notification provider decision
- the public hostname for the rental service
