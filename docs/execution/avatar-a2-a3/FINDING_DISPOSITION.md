# A2/A3 independent findings — retained LOWs

Independent verdict: **PASS**. Original review is preserved verbatim in
[final-review/review.json](final-review/review.json), bound to code/evidence HEAD
`950e7e0aa414d4d55ba9ae4ce1f92eab6425899a`. BLOCKER0, HIGH0, MEDIUM0, LOW3.
No finding is removed, downgraded, or marked independently closed. No product code
changed after this review. One allowed review was used; no retry/re-review occurred.

| Finding | Severity / disposition | Current boundary and later decision |
|---|---|---|
| AV-1: visual row binding fields can be updated | LOW / OPEN_RECORDED | Current immutable revision-purpose binding makes ungranted retargeting ineligible; no writer route/runtime grant exists. Before adding any authoring endpoint, consider an additive migration limiting updates to presentation fields, with real-PG binding-field rejection tests. Existing0031 must not be silently rewritten after adoption. |
| AV-2: zero artwork omits the entire visualization, including ratios | LOW / OPEN_RECORDED | Deliberate current zero-visual behavior preserves the original business payload and matches the current tests. Phase4 must decide whether ratio-only presentation is useful. No payload/renderer change is authorized now. |
| AV-3: test reader role can SELECT full content_workspace JSON | LOW / OPEN_RECORDED | This is an isolated synthetic local test role, not a newly provisioned hosted/runtime role. Private bytes and business writes are denied, and no route exposes workspace data. Before production integration, assess a narrower projection/view and test read scope. |

These are Codex disposition notes, not a substitute for the independent review.
Any future binding-field/permission/contract changes must obtain their applicable
scope and review authority; this PASS does not automatically transfer to changed code.
The next exact gate remains **AVATAR PHASE 4 — CUSTOMER VISUAL RENDERER** (not started).
