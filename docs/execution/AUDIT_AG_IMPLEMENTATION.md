# A–G implementation record

Current authority: [owner delegation](AUDIT_AG_DELEGATION.md), immutable receipt
https://github.com/ginisato-hash/zao-rental/pull/9#issuecomment-5645441833.
Run01 starts2026-09-12T10:37:21Z, deadline18:37:21Z (JST19:37:21 to03:37:21 next day).
Historical review starts4; new shared budget8, none started at A/B/F implementation checkpoint.
No merge permission. E09_CONTINUATION remains the resolved time contract.

## A: target settings compare-and-set

Ordinary staff edit sends expectedRevision. Schema rejects missing/invalid values;
server compares the actual target revision under row lock before any field mutation.
Name/access/role/active writes and audit commit together. The returned revision is
read from DB after triggers; clients never guess +1. Display-name-only writes now
increment revision via additive0008. Login/failure/password timestamps do not.
409 preserves the user's stale form but disables submission until explicit reload;
no automatic revision replacement or resubmission. Two administrators are tested in
both orders for disable, role, permission and store removal, then explicit reload/save.
Acting-admin revocation is independently checked at the settings boundary.

## B: cancellation/write order with separated DB roles

Normal runtime binds the server-verified session ID and staff ID; browser role/store
or stamp are not identity. Initial forbidden-scope checks precede inventory waiting.
After inventory and target row locks, the ledger transaction acquires a shared
per-staff advisory71820901/hashtext key. A separate auth connection checks live
session, active staff, current view/edit permissions and actual store/global scope.
That read connection is released immediately. The shared key remains on the ledger
transaction through COMMIT/ROLLBACK, even if the auth connection fails. Settings
writers acquire exclusive sorted actor/target keys; existing staff/store/permission
revision triggers join this ordering through additive0008. A committed cancellation
therefore precedes refusal, or an already admitted write commits before cancellation.
This is an ordered protocol across two connections, not a single DB transaction.
Long inventory waits hold no staff key/auth connection. Existing short SQL/lock
timeouts bound failure; no new DB privileges or security-definer function was added.
Ledger still cannot SELECT staff tables; auth cannot UPDATE ledger; audit stays append-only.

Real-DB synchronization tests cover permission/store/disable cancellation during
update and create waits, target-row waits, reverse order at the final commit gate,
forbidden-store early refusal, correct actor audit and no idle-in-transaction residue.
This guarantee concerns active/role/permission/store settings, not a new universal
logout/credential change serializability contract. A live session is rechecked after waiting.

## F: finite HTTP request contract

Schema remains20people ×3components ×6candidate UUIDs. Maximal ordinary JSON
conditions/wrapped create/amend/quote measure18865/18932/18974/19058UTF8bytes.
Server-selected24576byte cap applies only to HOLD create/amend/availability and
quote create. Default16384 remains for auth, small ledger and other operations.
Actual stream chunks are counted, independent of Content-Length; overflow cancels
the reader and returns413. Invalid UTF8/JSON422; existing auth wrapper keeps its
sanitized400 for oversized auth input. Anonymous/CSRF refusal precedes parsing.
Whitespace padding is not an unbounded supported schema payload.

The ordinary password-authenticated direct API test sends18267bytes with actual
synthetic stock, creates20person/60component HOLD and a matching persisted quote,
amends/replays without duplicate claim/TTL extension. HTTP acceptance and stock
feasibility are separate assertions. E09 still expands choices internally without
passing that expansion through HTTP; this does not evade solver limitations in E.

Evidence: [manifest](evidence/audit-ag/abf/manifest.json). Initial meaningful baseline
failed all10 counterexamples; final23 normal-path checks,2body units and populated
0007→0008 migration passed. Ordinary UI uses synthetic individual password sessions,
not test principals. Migration preserves accounts/session, ledger, active group HOLD,
claims and immutable quote; simultaneous migrators and unchanged DB grants verified.
Independent review and whole A–G integration are pending at this checkpoint.

A/B/F integration checkpoint: full `npm run verify` passed at local evidence2026-09-12T11-09-49.855Z. All commands exit0, no skipped cases. Migration count expectations were updated to the registered plan; no applied migration content changed.


## C/D: targeted protection lifecycle

The ordinary ledger status/quantity path invokes a separate reconciliation transaction
using the existing transfer role, after early current inventory permission/store/version
checks. It acquires the existing inventory lock and shared actor key, checks the actual
server session again, and expires only eligible unpaid provisional groups touching the
requested resource. It excludes physical IN_TRANSIT/RECEIVED/READY witnesses. Payment
PENDING/UNKNOWN/SUCCESS, preparation/rental allocation stages and live leases are not
released. It then closes unreferenced, issue-free READY projections touching that resource.
The following ledger transaction re-locks and re-authorizes; the two connections/transactions
are **not** one atomic write. An intervening valid HOLD is refused by the unchanged stock
guard, while completed reconciliation itself remains durable and audited. No grant changes,
new endpoint, customer return or background worker.

READY without active dependent claims now closes in the actual ready operation, and target
ledger reconciliation handles previously completed projections. Explicit cancellation or
ordinary eligible HOLD expiry continues to leave dispatched physical movements/history in
place, as required by the existing E07 contract. Closing never changes receipt quantities,
location facts, idempotency keys or history. Source/destination slices leave the virtual
projection exactly once. A CLOSED physical movement still blocks reuse on its transport day
inside period matching; closing must not create an after17:00 same-day continuation loophole.

CD baseline: 0/4, identical cases after initial fix4/4. Expanded tests cover unpaid expiry,
all protected payment/allocation states, both inventory-lock race orders, partial receipt,
issue retention, referenced READY, explicit cancel/cleanup, replay, future physical stock,
same-day continuation rejection, and both completion/new-HOLD lock orders. Old E07 tests
which expected unreferenced READY now assert CLOSED strictly, not either state; readiness UI
counts CLOSED as prepared. These are lifecycle corrections, not weaker stock expectations.

## E: dependency scope and capacity proof

Read at most10001 live promise metadata rows; if more than10000 exist return INDETERMINATE,
never silently discard rows. Follow a conservative **transitive group closure**: a shared
variant plus intersecting inclusive custody intervals connects whole groups (including their
other components). Cross-store return intervals extend to9999-12-31, preserving custody
fences. Store is not used to sever graph edges. Initial day/variant filtering alone is unsafe.
After closure, read full conditions only for connected groups. Connected mutable requirements
retain the240 bound; the old whole-repository80 bound is removed. Non-replanned live claims,
including outside the closure, are kept as fixed witnesses for all relevant physical/pole units.
Transfer and maintenance rows are filtered by relevant immutable variant/resource identities,
not by guessing that an unrelated date implies unrelated custody. Constraints and projection
quantities remain active in both real and diagnostic matching.

Remaining explicit guards:10000 live metadata rows,1000000 dependency-edge inspections,
240 connected mutable+candidate requirements,3000 physical/virtual units and relevant transfer
pieces,10000 relevant constraints,100000 relevant fixed daily claims,100000 matching visits;
existing database lock/statement timeouts. Hitting a guard returns INDETERMINATE, not a success
or sold-out claim. No higher global cap is claimed as the underlying fix.

At interval starts, capacitated bipartite Hall checks prove obvious insufficiency before
period backtracking (9 units/10 simultaneous people). Residual free capacity precedes
augmenting chains. A successful per-day matching alone never proves a continuous Asset:
the bounded backtracking still chooses one unit for the entire interval. Fixed placements,
quantity capacity and all-group atomic writes remain. Independent exhaustive enumeration of
250 deterministic small cases checks equivalence, including fixed capacity. Real PostgreSQL
covers81 independent groups/243 components,81 connected single-unit promises, simultaneous
independent demands, transitive variant+date chains and cross-store future custody.

## G: bounded repeatable reads and mixed HTTP operations

Variant validation reads the union of IDs once, then verifies every member/item against the
map: family, age, tier and presence are still individually enforced. Quote get/list share a
batch view that validates current request principal/store scope, each owner and snapshot hash,
then reads referenced holds and transfer-attention together. All state remains inside the
existing repeatable-read transaction for lists; no cross-request/user cache. Later requests
revalidate the actual session/current permission revision as before. No price/snapshot rewrite.

Real-PG before/after:60 component validation SELECTs→1 (total71→12 at the injected-clock
service boundary);100 quotes sharing valid HOLD:510→15 total SQL statements. Normal-runtime
clock queries add their own statement; this is not a claim of identical counts for HTTP/auth.
The mixed HTTP test uses normal synthetic password sessions,300 combined ski/board Assets,
300 boot Assets,150 pole pairs,90 live one-person DAY HOLDs/270 components and100 saved quotes.
It runs6 operation families concurrently over8 batches and records operation-specific raw
latencies, errors, timeouts and INDETERMINATE. HOLD-create-plus-quote is two HTTP requests per
measured invocation. Setup requests are excluded. Actual dispatch/receive/readiness are
separately recorded. Mobile390px is a viewport simulation, not a physical phone test.
Historical E09 preview-only Mac~100ms/CI~237ms values remain preview-only; neither those nor
this synthetic loopback test guarantees production performance.

## Independent checkpoint01 and remaining integration

Claude at8467d11 independently confirmed A/F and the current B normal route, but reported
MEDIUM B-FAILOPEN-01: an optional authorizeWrite could be accidentally omitted. A failing
configuration test was added before correction. LedgerService now requires the function at
type level and fails closed at runtime before DB access if omitted/invalid. All fixture-only
callers explicitly name their no-op boundary; the only apps caller uses verifyLedgerWrite.
No ordinary-path principal/header/env bypass was introduced. The shared review count is1/8,
old E09 actual4 retained separately. C/D/E/G and this correction still require independent
integrated confirmation. The prior scoped review is not a new-head PASS.
