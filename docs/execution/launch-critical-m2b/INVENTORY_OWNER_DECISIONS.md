# Inventory: decisions needed from the Owner

Each open item below blocks the real import. None can be inferred from the supplied file, and
none has been guessed. Figures come from `INVENTORY_SOURCE_AUDIT.md`.

## 0. Registration scope — DECIDED

This round registers four families only, with the lending unit fixed for each:

| family | rows | units | lending unit |
| --- | --- | --- | --- |
| `SKI` | 18 | 213 | one pair, one Asset |
| `SNOWBOARD` | 12 | 205 | board with its mounted binding, one Asset |
| `SKI_BOOT` | 19 | 242 | left/right pair, one Asset |
| `SNOWBOARD_BOOT` | 18 | 241 | left/right pair, one Asset |
| **IN_SCOPE_TOTAL** | **67** | **901** | |

`SNOWBOARD_BINDING`, `HELMET` and `POLE` are `EXCLUDED_BY_OWNER_SCOPE` for this round — 19 rows,
591 units. Their schema, family definitions, existing stock, recommendation, reservation
constraints, loan/return handling and importer support are untouched. `WEAR_JACKET` and
`WEAR_PANTS` are `FUTURE_INPUT_REQUIRED` and absent from this source; the earlier "wear 200"
figure is not revived, and no wear quantity, size or store split is assumed.

Boots are never split into left and right Assets. Where both sides are labelled, both labels
carry the same Asset ID.

`SOURCE_RAW_TOTAL` stays 86 rows and 1492 units. Registering the 901 is not "all stock
registered" and not "every rental product ready to sell". Set products needing poles or other
excluded items still have their stock checked; nothing here relaxes that.

## 1. Tier — blocks all 67 in-scope rows

The catalogue requires `REGULAR`, `PREMIUM` or `STANDARD` per variant. The source carries no
class at all. Product names like `S/MAX` are model names, not evidence of a premium class, so
nothing was assigned.

Simplest resolution: confirm that this entire delivery is `REGULAR`. If some models are meant
to be premium, they need naming individually.

> Decision: ............................................................

## 2. Store allocation — blocks all 67 in-scope rows

The only destination on the file is the company itself. The system needs each unit assigned to
`MOUNTAIN_BASE` or `ONSEN_BASE`; an even split was not assumed.

This can be given per row, per family, or as an overall rule. Note that **both stores must be
covered** before the launch gate can report real data as ready.

> Decision: ............................................................

## 3. Helmets and snowboard bindings — CLOSED for this round

Superseded by §0. Bindings are part of the snowboard's single Asset and are never registered
independently; helmets are out of scope this round. `ACCESSORY_MODEL_OWNER_GATE` is removed as
a blocker for this round's scope and is not resolved for helmets — it is simply not in the path.

This document previously stated that all 227 binding units were `BOARD BIND. UNITE (4 IN 1 PACK)`
and offered 227 × 4 = 908. That was wrong: 144 of the 227 are UNITE rows (source rows 70–72,
32/76/36) and the other 83 are not (rows 83, 87, 88 — 75/4/4). See `ACCESSORY_MODEL_DECISION.md`.

## 4. Binding pack semantics — NOT A GATE for this round

Whether 残数 counts packs or individual bindings, and whether a unit is one side, a pair or a
set, remains unconfirmed for the 144 UNITE units and separately for the other 83. Because no
binding is registered independently, this no longer gates registration and no vendor enquiry is
raised for it. It stays recorded as an open property of the source. None of 227, 659 or 908 may
be adopted as a physical quantity.

## 5. Boot sizes expressed as ranges

Adult ski boots use paired sizes such as `23/23.5`, while snowboard boots use single values
such as `24.5`. Both were preserved exactly as written. Confirm that the paired form is the
size customers will be matched on, since it becomes the catalogue size.

> Decision: ............................................................

## 6. Asset identifiers

Skis, boards and both boot families need one permanent identifier per physical unit — that is
the identity printed on the label and scanned thereafter. The file carries none. They can be
generated once counts and store allocation are fixed, but they are then permanent.

Confirm whether the shop already has its own numbering to preserve.

> Decision: ............................................................

## 7. Final quantities and source approval

This file is a planned delivery. Real import needs the confirmed received quantities, after
which the final file's SHA256 is registered once, deliberately, at the deployment boundary.
Importing staff cannot approve their own file.

> Final file and confirmed quantities: ............................................................

## Not blocking, but worth confirming

- Season `2026/27`, read from the `2627` token in the shipment comment on every row.
- Brand `SALOMON`, from every row's `SAL…` hierarchy.
- Status `UNVERIFIED` on arrival, becoming available only after physical inspection.
- Ski boot BSL stays empty until measured; it is never inferred.
