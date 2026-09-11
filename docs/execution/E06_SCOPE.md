# E06 scope and development operation

Authorized: supervised time contracts, period feasibility, atomic group HOLD, mutable
provisional assignment/replanning, protected staff UI/API and real PostgreSQL tests.
E03 other work, prices, recommendation/fit, customers, E07 operations, Square, QR/handoff,
production deployment and unattended Runner are not implemented/activated.

Run the pinned setup and `npm run verify` in this worktree. Individual checks:
`test:inventory` uses real isolated PG including populated PR5 upgrade and concurrency;
`test:holds-ui` uses a built normal app, actual password/session library, protected HTTP
routes and real PG. Existing auth/ledger/unit/reference/UI regression suites remain.
No test principal, fixture endpoint, test clock or direct SQL identity enters normal UI.

For a human local check, `npm run dev -- --bootstrap-admin` creates a fresh isolated DB
and asks for an explicitly chosen synthetic admin email/name and hidden password in the
terminal (no secret in commands/chat). Use the printed 127.0.0.1 URL. Create synthetic
models/variants/assets/pole pairs with AVAILABLE status via the ledger. In staff management
create a separate synthetic STAFF with assigned stores and explicit HOLD_VIEW + HOLD_EDIT.
Log in as that STAFF, open /staff/holds, select period and all component sizes, check
feasibility, acquire/amend/cancel, reload and re-login. The bootstrap account does not
automatically receive HOLD permissions; an ADMIN creates the authorized test STAFF.
`Ctrl+C` stops only this owned Web/DB. The next startup is a new empty disposable DB.
There is no persistent/public/LAN development deployment or real staff enrollment.

`/api/holds/options` gives catalog variants; GET /api/holds lists only one's latest 100
HOLDs; GET /api/holds/:id reads own record. POST /api/holds/availability is advisory.
POST /api/holds with {requestKey,conditions} obtains the all-or-nothing HOLD.
POST /api/holds/:id/amend uses the same fields; cancel/expire accept requestKey only.
Request keys are UUIDs; exact replay is bound to owner and canonical payload fingerprint.
A replay preserves the operation outcome while returning the current HOLD state. A new
key represents an explicit new attempt. Unknown transport outcomes retain the original
key in the UI; no automatic retry with a different key. TTL is 10 minutes, not renewed
by amendment. Only synthetic request targets are used; no booking/customer is fabricated.

Future E07 input: protected source/destination commitment, batch/version, departure and
actual receipt/readiness, immutable asset or quantity identities, plus atomic revalidation
against these claims. Receipt must precede destination readiness; timetable is not receipt.
Preparation/fixed/rental stages are represented but only fixture-supplied in this task.
No preparation shelf UI, previous-day picking, scanner, dispatch or checkout is shipped.

Three evidence categories: real PostgreSQL/normal UI automated checks; contract-only
payment/transfer/preparation states; not executed real staff/phone/production/provider.
The 300 combined ski+board load fixture and all smaller samples are synthetic. Component
boots/poles are additional units. Wear ~200 is only the unchanged planning assumption;
no wear selling/unit/reservation policy is invented. No real workbook import is performed.

POST /api/holds/:id/reassign accepts requestKey, requirementKey and assetId, with no
replacement conditions. It may pin one candidate for this atomic replan only; original
model/size/age/tier/period/store promises remain unchanged. Non-candidate Assets and
fixed stages cannot be reassigned. This is a protected allocation API, not a scanner,
preparation or handoff workflow. The resulting internal witness remains provisional.

POST /api/holds/:id/availability previews replacement of one's existing provisional
HOLD, excluding its old witness while revalidating every other promise. The selected
HOLD screen uses this route; it does not count the old and proposed claims twice.
