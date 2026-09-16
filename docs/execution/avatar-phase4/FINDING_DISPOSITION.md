# Phase4 independent findings

Independent verdict **PASS**, reviewed implementation/evidence HEAD
`790b809a8d8a8989594e0982e264b3a220527936`: BLOCKER0 / HIGH0 / MEDIUM0 / LOW4.
Original independent result is preserved unchanged in [final-review/review.json](final-review/review.json).
Initial review1/1; correction0/1, retry0. No code changed after review; LOW-only PASS
does not authorize or require another review. These disposition notes are not independent closure.

| ID | Original severity / disposition | Current boundary and remaining proof |
|---|---|---|
| AV-1 | LOW / OPEN | Existing0031 still permits binding-field updates. No writer/editor API was added. Current immutable revision-purpose binding is revalidated on delivery. Before future authoring, separately assess binding immutability and negative real-PG proof; do not rewrite0031. |
| AV-2 | LOW / RECORDED_PRODUCT_DECISION_NOT_INDEPENDENTLY_CLOSED | Owner explicitly selected zero artwork → no renderer → no fake image. Tests implement that scoped product choice; the original finding remains recorded. |
| AV-3 | LOW / OPEN | Broad content_workspace SELECT remains in the synthetic local test role. No new hosted/runtime role or provisioner change; no workspace JSON response. Production privilege minimization still needs its own scoped implementation and proof. |
| PHASE4-1 | LOW / OPEN | Byte delivery requires staff BOOKING_VIEW; the saved-recommendation preview additionally requires HOLD_VIEW/QUOTE_VIEW plus owner/store checks. The current image minimum follows authority §23; extra page permissions protect the saved business preview read. This distinction is now explicit, but isolated BOOKING_VIEW-only browser/PG proof was not run. A future authorized change must test that exact principal and decide whether to align permission sets before expanding discovery or customer access. |

PHASE4-1 is a real authorization asymmetry, not a secret/public bypass: current bytes
still require ordinary authenticated staff, exact visual UUID/digest and current rights.
Do not treat unguessable identifiers as authorization. The existing test denies both
surfaces by revoking BOOKING_VIEW; it does not prove the BOOKING_VIEW-only case.
The requested follow-up test and any permission alignment are NOT_RUN/NOT_IMPLEMENTED
in this receipt-only step. No finding is silently removed, downgraded or marked closed.

Next exact gate: **AVATAR PHASE 5 — GUEST BOOKING INTEGRATION + REAL ARTWORK ACTIVATION**.
Separate authority is required; no automatic continuation or activation.
