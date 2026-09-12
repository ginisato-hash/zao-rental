# Local content/catalog/photo fixture evidence

The adopted pack permits a local fixture when external CMS/storage rights are absent.
This checkpoint uses that option; normal staff email/password and real auth PostgreSQL,
with synthetic explicit fixture-only CONTENT grants. No normal production route,
actual staff grants, external storage, supplier extraction, customer publication or
real photographs are activated. Original base schema and old equipment custody guards
are unchanged. The automatic-review custody blocker is still open.

Passed normal UI stages: CSV dry-run; target-partial apply; lost response/reload replay;
immutable private release/current/outbox; actual Web restart; rights revocation and
new-manifest restore;50photo sequential transform with response loss/resume and guarded
thumbnails; source-sheet staging/dedup/changed-cell reconciliation; normal administrative
API account disable and revoked fixture-grant rejection. Three tests failed during
implementation: unresolved Web fixture path; stale UI status mistaken for completed
release; obsolete staff view used for a test write. Each was corrected and rerun.
Photo integration also exposed ambiguous status selectors and a duplicated synthetic
filename. No production guard or duplicate-name rejection was weakened.

`tests/unit/content-workflow.test.ts` uses an in-memory transaction adapter and fake
CONTENT authority for CAS/rollback/after-wait tests. These are not real CMS DB proofs.
`tests/content/normal-ui.ts` uses the actual password/session DB and protected Next
routes, plus local file storage for content/media. Authentication is real library
flow with synthetic people; the content storage is a fixture.390px width is a browser
viewport, not a physical phone or a user study. Current UI deliberately exposes
fixture/development labels; it is not the production guest UX.

Review4 WEAR-BOOKING-SCOPE-IMPLICIT-01 was non-exploitable in its submitted head.
The followup makes canReturn/canCheckout each explicitly depend on receiving-store
membership, retaining early BOOKING_VIEW authorization. Real PostgreSQL verifies an
Onsen-only recipient cannot access Mountain, can accept scoped cross-store return,
cannot check out at the wrong store, and loses access when RETURN permission is removed.
The separate actual inventory-lock wait / scope-revocation test remains in test:wear.

Evidence logs/screenshots: evidence/flow-dev/content-fixture/. Exact final-head verify,
CI and static review are tracked in FLOW_DEV_STATUS and the PR comments. No snapshot
may treat this local fixture as the complete production CMS or full E10-E13 milestone.

Full35-command verification passed. Afterward, the concurrent-photo test counted two
actual decoder starts for the same pending item. A single bounded exclusive adapter
gate now covers decode and commit, with authority rechecked after decode and before
private writes. The same test observes one decoder invocation. This gate is a file
fixture lock; no reservation DB connection is held.123unit and8ordinary UI tests,
lint and typecheck then passed. The final CI must run the complete latest tree.
The8UI cases also cover explicit photo pause,50file response-loss recovery and the
18real equipment offer codes as synthetic content-only fixtures. No prices changed.
