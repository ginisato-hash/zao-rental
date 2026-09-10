# INVENTORY_SAMPLE.md — Supplied 2025/26 Inventory Workbook Review

Source: supplied workbook "樹林更新板25_26サロモンステーション蔵王 在庫数(1).xlsx".
This is a test/seed dataset, not authoritative 2026/27 production stock.

## Useful seed counts
| Family | Segment | Approx. quantity in workbook |
|---|---|---:|
| Ski | Adult normal + expert | 32 pairs |
| Ski | Junior | 29 pairs |
| Ski boots | Adult | 36 pairs |
| Ski boots | Junior | 33 pairs |
| Poles | Adult + Junior | 74 pairs |
| Snowboard | Adult normal + expert | 37 boards |
| Snowboard | Junior | 18 boards |
| Snowboard boots | Adult | 38 pairs |
| Snowboard boots | Junior | 30 pairs |
| Snowboard bindings | Adult | 64 units |
| Helmets | Adult | 80 units |

Legacy workbook also contains wear inventory, but current V1 scope excludes wear from customer rental products.

## Observed size ranges
- Adult ski: roughly 140–167 cm plus specific S/MAX 6 lengths 139/146/153/160
- Junior ski: roughly 70–140 cm
- Adult ski boots: roughly 22X–31X
- Junior ski boots: roughly 15X–24X
- Adult snowboard: roughly 135–165 cm
- Junior snowboard: roughly 90–130 cm
- Adult snowboard boots: roughly 22X–31X
- Junior snowboard boots: roughly 17X–24X
- Poles: roughly 70–135 cm

## Import strategy
Do not import this sheet as if each row were already an individual Asset. It is quantity-by-size inventory.

For test data generation:
1. Parse product family, segment, model/article name, size and quantity.
2. Expand quantity rows into synthetic individual Asset records.
3. Assign neutral asset IDs that do not encode current store location.
4. Allocate test assets across Mountain Base / Onsen Base through a seed allocation file.
5. Keep original source-row metadata for traceability.

## Proposed asset ID prefixes
- ZRS-SKI-000001 — ski pair
- ZRS-SNB-000001 — snowboard
- ZRS-SKB-000001 — ski boot pair
- ZRS-SBB-000001 — snowboard boot pair

Poles should initially be modeled as pooled size inventory unless individual tracking becomes operationally valuable.
Helmets should initially be pooled complimentary inventory unless reservations or hygiene/inspection workflow require individual tracking.

Store location must not be encoded in the asset ID because assets are allowed to move between Mountain Base and Onsen Base.
