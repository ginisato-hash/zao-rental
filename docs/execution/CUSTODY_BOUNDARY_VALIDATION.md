# Custody boundary R1 — validation map and limits

Approval: ZAO-FLOW-CUSTODY-DB-BOUNDARY-R1. This is an implementation/evidence record,
not authorization for production, a real booking/payment, or PR10 merge.
Fixed run:2026-09-12T22:51:31Z–2026-09-13T04:51:31Z /07:51:31–13:51:31 JST.
New independent review budget:1 final launch after exact-head CI; prior FLOW7 launches
remain historical and its unused launch is not added. Current results/remaining budget:
[CUSTODY_BOUNDARY_STATUS.json](CUSTODY_BOUNDARY_STATUS.json).

## Exact source and evidence

Delta baseline6b146f7e84c77e8626d7c15c454c25f01ac6559e; base/main
137352fcaa7b28f88aef5100479297f74e64b4aa. Applied0001–0014 and equipment18products/
216prices are unchanged. New0015 uses the existing0009–0011 booking/custody schema.
The old FLOW_DEV_STATUS and WEAR_ACCEPTANCE_STATUS were uncommitted final records at
start. Their original bytes are preserved separately and retained as historical progress;
this boundary's status takes precedence over their historical custody BLOCKED wording.

Local raw evidence root: outputs/custody-boundary-r1 under the owning Codex workspace.
Final exact-head evidence is attached to the Draft PR10 comment; CI and review artifacts
are mapped by full SHA, not by the last green workflow name. Local verification inputs
are hashed, then compared against committed source. CI tests the PR merge candidate with
base/head parents and the same tree as the head. Historical failures are not overwritten.

Counterexamples:
- before-boundary.log exit1: on6b146f7 the proposed UUID receipt function was absent.
  after-boundary.log exit0: the same real-DB assertion succeeds after0015. This proves
  the formerly unimplemented boundary, not an old exploitable receipt implementation.
- afterhours-before.log exit1: newly implemented MULTIDAY checkout incorrectly accepted
  17:01 on its first day. afterhours-after.log exit0: identical scenario rejects physical
  handover after existing17:00 closing, while return/inspection remain possible.
- verify-01 failed at an obsolete expected migration list; list now includes0015.
- verify-02 exposed a pole-only NEW.quantity reference during Asset transfer; nested
  table-specific handling fixed it; the same20-case E07 real-DB regression then passed.
- verify-03 exposed current services being called against pre-custody schemas in historical
  upgrade setup. tests/fixtures/legacy-prefix.ts now seeds explicit valid old rows before
  additive migration. Runtime custody checks are still mandatory, without optional-table
  bypass. Pricing/recommendation/stabilization upgrade tests preserve sessions/claims/quotes.
- verify-04 found a new Premium availability test fixture missing INTEGRATED_V1_2; the test now uses the actual protected HOLD API with the saved contract, without changing product logic.
- verify-05 passed all37 commands (every exit0), including24 grouped custody PG cases and5 normal UI/API/PG cases. Runtime/test/config inputs307files remained byte-identical through verification.
Other early development logs include locator/type/fixture corrections; they are not final PASS.

Tracked evidence: [command results](evidence/custody-boundary-r1/commands.json),
[DB cases](evidence/custody-boundary-r1/test-custody.log),
[UI cases](evidence/custody-boundary-r1/test-custody-ui.log),
[desktop screenshot](evidence/custody-boundary-r1/custody-desktop.png),
[390px width screenshot](evidence/custody-boundary-r1/custody-mobile-width.png).
Screenshots contain synthetic records only; width tests are not physical device verification.

## Owner-required cases

PG = tests/custody/real-postgres.ts; SC = tests/custody/scenarios.ts;
UI = tests/custody/normal-ui.ts. All use actual isolated PostgreSQL. Tests marked UI use
Next screens, maintained password/session authentication and protected HTTP; their data and
payment adapter are synthetic. Direct SQL adversarial cases intentionally use the app role
and separate test-owned owner connections; they are not a new public endpoint.

| Requirement | Concrete evidence |
|---|---|
|1 PUBLIC cannot execute receipt/inspection|PG checks PUBLIC ACL entries and ungranted application execution denial|
|2 app cannot become owner|PG SET ROLE executor/migration owner rejected; no DDL/history/loan-state/claim-delete rights|
|3 hostile temp/writable schema|PG same-name tables/functions/operator ignored for both applied and unapplied receipt; only trusted tables change|
|4 other staff UUID|PG distinct normal staff session cannot apply another actor's receipt|
|5 correct actor, no actual store|PG removes receiving store through normal account service; direct UUID call denied|
|6 permission revoked while waiting|PG service and SC direct UUID function wait on real inventory lock, then reject after normal permission change|
|7 staff disabled while waiting|PG service and SC direct UUID function reject disabled/revoked session; OUT retained|
|8 stale version|PG invalid pinned version rejected by DB; service records REVIEW, no new receipt|
|9 same receipt/key retry|PG/SC unique effects and readback; no second location/quantity/history change|
|10 two terminal returns|PG serialized; SC pole: one receipt, second pinned candidate becomes stale|
|11 both side labels same ID|PG/ UI duplicate scan creates one candidate for that loan; no left/right sub-asset|
|12 Mountain→Onsen actual|PG/SC/UI verify actual location and RETURN_RECEIPT history, no source auto-return|
|13 partial return|PG/SC/UI retain other equipment/member OUT; mixed wear pants remain outstanding|
|14 future promise|PG independently confirmed/prepared future HOLD retains claim and PREPARATION_FIXED; reconciliation required|
|15 fixed allocations/transfer|PG future preparation remains fixed; SC loaned individuals/pairs cannot be moved by E07; existing E06/E07 tests preserve dispatched/fixed witnesses|
|16 pole partial quantity conservation|SC two people, one pair returned concurrently; sum conserved, source OUT+at-store projection, destination maintenance→inspected pool|
|17 receipt is not sellable|PG/UI pending inspection excluded; poles physically in destination MAINTENANCE|
|18 ready still blocks same day|PG/SC same/original contract date blocked; subsequent date may work; UI Premium candidate unavailable same day|
|19 Premium exact promise|UI rejects different model and length through protected API; DB checks saved model/season/variant plus whole-period witnesses|
|20 existing regression|verify includes Regular, quantity wear, E07, intake/HOLD continuation/cm, quote/payment and A–G tests|

Additional SC cases: distinct store-scoped staff can take over checkout from booking creator;
old scan cannot retarget a later real loan of the same Asset; all four serialized families
preserve BOARD/PAIR units. Additional UI cases: synthetic canvas QR frames reach the real
candidate API with one camera acquisition, then explicit stop ends tracks; normal and unknown
candidates coexist; response loss after committed receipt recovers after reload with the same
saved key; logout/disable, CSRF and actor spoof denial. Camera fixtures do not prove a phone.

## Semantics and remaining limits

- Receipt UUID/inspection UUID are the only exposed privileged mutation inputs. The client
  cannot directly write locations, history or loan states, nor access private effect rows.
  Private effect rows are bound to transaction/backend and exact validated target. The trusted
  migration superuser remains capable of changing DDL; this is not superuser containment.
- One ski pair, one board, one boot pair are individual Assets. Poles remain PAIR quantity
  accounting slices associated with exact loan/member. Wear remains JACKET/PANTS size pools,
  with no garment Asset/QR. New gear and wear loans share booking/member/cycle identity.
- Preparation confirms the complete existing full-period assignment and human fit note.
  Provisional choices remain flexible before preparation. This UI does not add a new generic
  scan-and-substitute workflow or paid mid-rental exchange. BSL stays UNVERIFIED where unknown;
  no DIN or safety certification is calculated. No reopening fixed/unknown promises.
- Confirm retires only the fulfilled item's claims; other promises remain protected and may
  require reconciliation. Original quote/booking snapshot and HOLD expiry are unchanged.
  Receipt, inspection and calendar-day eligibility are distinct. No early-return refund.
- Ledger pool quantity is accounted stock, not period availability. Actual-at-store and OUT
  PAIR counts are separate; cross-store receipt moves accounting quantity to actual destination.
- Return confirmation records server receipt time. Correcting actual receipt times, exception
  inspections beyond READY, and operational resolution of reconciliation remain later work;
  no editable date/actor/expiry bypass is introduced.
- The callable screen/API exist in tests/flow-app only. Normal apps/web does not expose custody
  mutations or a test payment adapter. Reproduce finite automated UI via `npm run test:custody-ui`
  and DB boundary via `npm run test:custody`; each starts and stops only this worktree's resources.
  `npm run verify` adds all existing regressions. No persistent demo/service is installed.
- All samples are SYNTHETIC. Real people, observed stock, Square/Sandbox transport, public guest
  service, real email, physical phone/camera, real fitting, operational cleaning durations,
  catalog/photo completeness and production activation remain unverified/unconnected. No
  claim that the full E10–E13 production milestone is complete. PR3/Runner stays held.
