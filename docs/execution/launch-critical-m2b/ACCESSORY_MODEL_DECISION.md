# Helmets and snowboard bindings: model decision

371 of the 1492 planned units cannot be represented today: 144 helmets and 227 snowboard
bindings. The canonical importer accepts only `SKI`, `SNOWBOARD`, `SKI_BOOT`,
`SNOWBOARD_BOOT`, `POLE`, `WEAR_JACKET` and `WEAR_PANTS`, and the recommendation, reservation
and custody paths are built around those families.

No new family was added during M2B. This is the comparison the decision needs.

## Helmets — 144 units, sizes `S 5356`, `M 5659`, `L 5962`

**A. Per-asset with a QR label.** Each helmet gets a permanent identifier, like a ski or a
board. Gives full custody history and per-item inspection, which matters for a safety item.
Costs 144 labels, and helmets are small and knocked about, so labels will be damaged and the
manual fallback will be used often.

**B. Size-based quantity pool**, like poles. Three pools, no labels, very little handling
overhead. Loses per-item history: a specific helmet cannot be traced to a specific customer or
retired individually after an impact.

The deciding question is whether a helmet needs an individual inspection and retirement record.
If it does, A is the honest model despite the label overhead.

## Snowboard bindings — 227 units, sizes S/M/L

**A. Component of a board.** Bindings are mounted and travel with the board. The rental unit
stays the board, and the binding is part of its configuration. Closest to how they are used,
but needs a board-to-binding relationship the schema does not have, and remounting between
boards becomes a data change.

**B. Size-based quantity pool.** Simplest; matches how the file is written. Loses which binding
is on which board, which matters if a fault is traced back later.

**C. Per-asset.** Most faithful, heaviest: another 227 labelled items whose labels sit on a
mounted component.

The pack ambiguity compounds this: if 227 counts four-packs, the real figure is 908 and per
asset handling becomes considerably more work. **Confirm the pack question before choosing.**

## Consequences of deferring

Deferring is reasonable, but it must stay visible. Until the model is chosen:

- a completed real import covers 1121 units, not 1492
- helmets and bindings are tracked outside the system, or not at all
- the launch gate's real-data row reflects only what was actually imported

That is acceptable for a staged opening as long as nobody reads "real data ready" as "all
stock is in the system". It is not acceptable to quietly drop 371 units.

## Status

`ACCESSORY_MODEL_OWNER_GATE`. Core inventory preparation continues meanwhile; nothing here
blocks the ski, board, boot and pole path.
