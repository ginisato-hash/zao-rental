# Accessories: Owner scope decision, and the correction to this document

> **This document previously contained a factual error.** It treated all 227 binding units as
> `BOARD BIND. UNITE (4 IN 1 PACK)` and offered 227 × 4 = 908 as a conversion candidate. That
> was wrong on both counts, and the correction is below. The error was in this document, not in
> the source audit: `INVENTORY_SOURCE_AUDIT.md` already recorded the three UNITE rows and 144.

## Correction: the binding rows, per source row

Source SHA256 `5ff5ce67c8ec1afbfab6bc5beeab0a2a725b73db0e1958a02860a0db39fbe1f4`, Sheet1.

| source row | item code | product | JP size | 残数 |
| --- | --- | --- | --- | --- |
| 70 | `L47668600` | `BOARD BIND. UNITE (4 IN 1 PACK) Black` | S | 32 |
| 71 | `L47668600` | `BOARD BIND. UNITE (4 IN 1 PACK) Black` | M | 76 |
| 72 | `L47668600` | `BOARD BIND. UNITE (4 IN 1 PACK) Black` | L | 36 |
| 83 | `L47669000` | `BOARD BIND. THE FUTURE Black` | XS/S | 75 |
| 87 | `L47337200` | `BOARD BIND. GOODTIME XS BLACK` | XS | 4 |
| 88 | `L47944400` | `BOARD BIND. GOODTIME XXS` | XXS | 4 |
| | | **UNITE subtotal** | | **144** |
| | | **other bindings subtotal** | | **83** |
| | | **binding total** | | **227** |

So 144 of the 227 carry the 4-in-1 pack wording; the remaining 83 do not. 908 was never a
defensible figure, and neither 227, 659 nor 908 is a confirmed physical quantity.

## Owner decision: bindings are not managed separately

A snowboard is **one lending unit**: the board together with its mounted binding, and one
snowboard Asset ID. A binding therefore gets no rental product, no reservation stock or slot,
no rental price, no Asset ID or QR label, no loan/return line and no quantity pool of its own.

A board and its binding are never counted twice to inflate availability, and the number of
available snowboards is never derived from binding purchase quantities. No separate binding
family, parts-management or assembly-management system is added for this.

This is not permission to mark an unprepared board — one with no binding mounted, for example —
as `AVAILABLE`. That stays a matter for the existing state handling, and is not solved by
creating standalone binding stock.

Because bindings are not registered independently, the pack-count question (whether 残数 counts
packs or individual bindings, and whether a unit is one side, a pair or a set) is **no longer
an Owner gate for this round**. It stays recorded here as an unresolved property of the source
data, and no further investigation, implementation or Owner request is raised for it.

## Helmets — 144 units, out of scope this round

`HELMET` is excluded from this round's registration by Owner scope. The comparison that was
recorded here — per-asset with a QR label versus a size-based quantity pool, turning on whether
a helmet needs an individual inspection and retirement record — is retained as input for
whenever helmets are registered. No model is chosen now, and none is needed now.

## Status

`ACCESSORY_MODEL_OWNER_GATE` is **removed as a blocker** for this round's registration scope.
It is not resolved for helmets; it is simply not in the path.

What must stay visible: this round registers ski, snowboard, ski boot and snowboard boot
bodies only. That is 901 of the 1492 planned units across 67 of 86 source rows. A completed
import of those rows is not "all stock registered" and not "every rental product ready to
sell", and must never be described as either. Set products that require poles or other
excluded items still need their stock checked; nothing here relaxes that.
