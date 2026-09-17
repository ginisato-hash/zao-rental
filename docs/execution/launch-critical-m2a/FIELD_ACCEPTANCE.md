# Field acceptance mode

Field acceptance is a **record of what staff observed**, not a special mode. Every scenario
is exercised through the ordinary screens and APIs with ordinary permissions. There is no
back door that writes business state, and recording a result grants nothing.

Recording needs the explicit `FIELD_ACCEPTANCE` permission on top of `OPERATIONS_VIEW`;
reading the launch gate does not allow recording. Both are denied by default.

Every record and every read is **store scoped**. A record is identified by run, scenario,
device class *and* store, so a member of staff scoped to one store can neither read nor
overwrite a result recorded at another. The cross-store aggregate and the launch gate need
explicit `ALL` scope, and across stores the worst result wins.

A scenario is bound to the device classes it can actually be performed on: an iPhone scan
can only be recorded from `IOS`, an Android scan from `ANDROID`, and no physical-device
scenario can be satisfied from a desktop. The database enforces the same matrix.

## What is stored

A run identifier, the scenario, the device class, the store, one of `PASS` / `FAIL` /
`NOT_RUN`, and a note chosen from a fixed list. **No free text field exists**, so a customer
name, contact detail or booking reference cannot be stored even by mistake. Re-recording a
scenario replaces that scenario's result and is idempotent under the same request key.

## Scenarios

Device: iPhone QR scan, Android QR scan, manual Asset ID fallback, duplicate scan, camera
permission denied, offline, reconnect, damaged label manual fallback.

Staff rehearsal: checkout, partial return, cross-store return, inspection required, pole
quantity, wear quantity.

Any scenario with no record reads `NOT_RUN`; it never silently disappears.

## Status in this phase

Physical iPhone and Android testing is **NOT_RUN**. This phase builds the tooling and the
record; the devices themselves are exercised in M2B.
