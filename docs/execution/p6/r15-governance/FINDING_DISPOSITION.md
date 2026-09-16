# R15 initial independent review — correction checkpoint

Initial exact head: `902622767cb255685d80ea34da90bb21fc5fce73`.
Original [structured review](review-01-review.json), [execution](review-01-execution.json),
[manifest](manifest.json). Verdict CHANGES_REQUIRED: HIGH3 / LOW1. Original severity retained.
No new external operation since Governance adoption. Initial review used1 of3;
correction review maximum1 and final post-live evidence review maximum1 remain distinct.

## F1 HIGH — factual correction and actual gap

The cited `r15HostedComposition` never calls CreatePayment. Its sole provider method is
`lookupPayment`; `SquareSandboxPaymentTruth` issues GET. There is no active R15 CreatePayment
route. The review's duplicate-charge example at that file is therefore not reproduced.
However reconstructing the composition does repeat **GetPayment**, violating its own max1
budget. [Before log](f1-before.log): 2 calls instead of1, same DB fixture and new instance.
This genuine gap is corrected, not dismissed on the review's mistaken method name.

New additive0030 and `dispatchR15Once` reserve each R15 action in PostgreSQL, synchronize
COMMIT before invoking the injected transport, and never reset after unknown responses.
Action is the primary key, not a TTL, process flag or caller-selected run ID. No reservation
exists until the migration owner installs the singleton manifest and exact persisted
Sandbox100JPY attempt. Worker receives only EXECUTE; it cannot install/change/read/reset
manifest or reservations. Public/receiver/other roles cannot reserve. Composition now
requires manifest SHA and uses this guard for GetPayment. Future finite CreatePayment
operator must use the same boundary; its wiring and live manifest are still NOT ACTIVATED.

Crash-before-COMMIT does not need a surviving reservation because dispatch has not happened.
Unknown COMMIT is conservatively stopped; completed COMMIT then child process death leaves
a permanent reservation, tested with a fresh independent process. A DB backup restored to
before a reservation must never be used to resume R15: restore/UNKNOWN is DO_NOT_RETRY.
No at-most-once claim across operator deletion, restored DB or a different resource.

Live manifest is **not populated with guessed location/payment IDs**. Prerequisite remains:
actual verified hosted identity and synthetic DB fixture → exact new R15 operation manifest
(branch/code SHA, resource/database, booking/attempt/idempotency/merchant/location,100JPY,
Sandbox, budgets) → commit/push/remote readback → migration-owner singleton installation.
One CREATE_PAYMENT reservation and one GET_PAYMENT reservation across all restarts; no
alternative key or manifest grants more budget. Schema0001–0029 remain byte-identical.

## F2 HIGH — non-disclosing handoff

`tools/acceptance/r15-signature-handoff.ts` validates the complete subscription context,
passes its key only in RAM to the exact dedicated ingress Vercel Sensitive environment,
and returns only a fixed state/project/key name. Existing Vercel CLI auth is used internally;
no credential extraction, shell interpolation, token argument, secret file, debug output,
upsert or automatic retry. CLI stdout/stderr stay bounded in RAM, exceptions are fixed
classes without causes. Response validation failure/timeout means UNKNOWN and metadata-only
reconciliation, never a new subscription/key. Tests deliberately reflect a synthetic key
through API success/error/invalid JSON and check no key escapes the boundary.

Vercel CLI59.17.0 `api --help` confirms --input - / --raw / --method. Official specs checked
2026-09-15: [Vercel env create](https://vercel.com/docs/rest-api/projects/create-one-or-more-environment-variables),
[Square create subscription](https://developer.squareup.com/reference/square/webhook-subscriptions-api/create-webhook-subscription).
The concrete sink is implemented and tested with a fake CLI pipe, **not executed live**.
A provider response must be consumed directly by this boundary, never printed or staged.
The actual protected operator/subscription transport wiring remains absent and unverified.

## F3 HIGH — unperformed hosted prerequisite and ordering conflict

Original HIGH remains recorded. Hosted Neon migrations/roles/tests are NOT_RUN. Local
loopback PostgreSQL evidence is explicitly not hosted evidence. Resource exists, is Free,
and consumes the single-resource budget; no recreation. Resource credential read previously
returned403; no values obtained, no permission workaround or new login/terms request.

There is a gate dependency requiring independent judgment: current Owner authority forbids
new external writes until initial/correction safety gate passes, while F3 requests actual
hosted migrations before that gate can pass. Do not apply hosted migrations merely to make
the review green. Ask the correction reviewer to distinguish code safety from an execution
acceptance prerequisite without prescribing verdict or reducing original severity. If the
review still requires hosted proof before continuation, preserve BLOCKED; only Owner can
resolve the sequence. No claim of finished hosted privilege separation or final live PASS.

## F4 LOW — residual build surface

The build installs the root dependency graph with lifecycle scripts disabled. The emitted
runtime bundle includes only receiver/pg dependencies, but installation is broader. Retain
this LOW residual during acceptance; do not treat it as permission for long-lived ingress.
No unrelated dependency rewrite in this correction.

## Corrections to review's proposed activation sequence

- Owner budget is historicaldeploy1 deleted plus **two additional** (total3), not total2.
- Missing-signature-key ingress POST remains503. Corrected bootstrap can deploy without key,
  create max1 subscription, non-disclosing handoff, then optional final redeploy. Never
  disable HMAC to get a successful test before receiving the key.
- Initial review consumed1; one correction and one post-live review remain. Post-live slot
  cannot be spent on another pre-live retry. Review PASS never means hosted/live success.

## Remaining live work, deliberately not marked complete

Hosted credential access / namespace / migrations0001–0030 / six least-privilege roles /
actual hosted negative permission tests; protected operator wiring and exact live manifest;
dedicated corrected deploy; subscription/handoff/final deploy; signed durable webhook;
conditional100JPY CreatePayment/GetPayment; hosted R12 truth/R13 projection and cleanup.
All after the applicable review/Owner gates. Main, Avatar, Runner unchanged.
