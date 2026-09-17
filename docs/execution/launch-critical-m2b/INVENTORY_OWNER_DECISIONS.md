# Inventory: decisions needed from the Owner

Each item below blocks the real import. None can be inferred from the supplied file, and none
has been guessed. Figures come from `INVENTORY_SOURCE_AUDIT.md`.

## 1. Tier — blocks every one of the 86 rows

The catalogue requires `REGULAR`, `PREMIUM` or `STANDARD` per variant. The source carries no
class at all. Product names like `S/MAX` are model names, not evidence of a premium class, so
nothing was assigned.

Simplest resolution: confirm that this entire delivery is `REGULAR`. If some models are meant
to be premium, they need naming individually.

> Decision: ............................................................

## 2. Store allocation — blocks every one of the 86 rows

The only destination on the file is the company itself. The system needs each unit assigned to
`MOUNTAIN_BASE` or `ONSEN_BASE`; an even split was not assumed.

This can be given per row, per family, or as an overall rule. Note that **both stores must be
covered** before the launch gate can report real data as ready.

> Decision: ............................................................

## 3. Helmets (144) and snowboard bindings (227)

Neither has a model in the system, so 371 of 1492 units cannot be imported at all today. See
`ACCESSORY_MODEL_DECISION.md` for the options and their consequences. Until this is settled,
a completed import covers 1121 units and the remainder is explicitly outstanding — it is not
quietly dropped.

> Decision: ............................................................

## 4. Binding pack semantics

`BOARD BIND. UNITE (4 IN 1 PACK)` — does 残数 227 count packs or individual bindings? The
difference is a factor of four, so no conversion was applied.

> Decision (vendor confirmation): ............................................................

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
