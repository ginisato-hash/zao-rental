# Release code closure — final local verification passed

Authority: Owner's 2026-09-23 takeover, capacity addendum, disk-recovery directive,
and subsequent authorization to resume genuine product fixes. No PR, workflow
dispatch, main merge or live activation is authorized by this checkpoint.

## Exact lineage

- Accepted Production Identity V5: ff5727f7d6bd02e2eb0707d5dccd246513cfc4d9.
- Normal integration merge into inventory: 982851e82a15822278bf61fabdd1f9bd4565dcf5.
- Release branch: claude/release-code-closure, created from that integration.
- A: 2b56826 commercial pricing; B: c6e46a9 shared Square Production engine;
  C: 214ee85 exact inventory witnesses. Remaining code is one closure checkpoint.
- V5 and inventory were normally pushed, exact remote readbacks matched, Actions 0.
  Release push remains gated on the final full verification result below.

## Implemented scope and proof boundaries

**A — Price authority.** Registered exact identity issues opaque, record-bound permits
for ZAO_2026_27_V1, source revision 0.3, wear revision
ZAO-WEAR-CATALOG-UX-20260913-V1_2, pinned source/table digests and initial DB revision 2.
Changing identity, record, revision or digest invalidates admission. Production alone
may create chargeReady quotes through this authority. No pricing arithmetic changed.
Tax display basis remains PENDING_OWNER_CONFIRMATION; no tax label/arithmetic invented.

**B — Square.** Sandbox and Production share the same engine/transport, idempotency,
JPY/amount/reference/merchant/location checks, deadlines, UNKNOWN behavior, lookup,
webhook signature, inbox and projection. Production has distinct explicit credentials
and origin. Card tokens are transient. Forged identities fail before I/O; no testing
identity issuer exists. Tests use injected transports and owned local PostgreSQL.
Genuine Production identity/provider acceptance remains an attended live gate.

**C — Exact inventory.** Admission and projection share a UNION ALL witness reader:
exactly one legitimate witness per protected requirement/day. Provisional gear/wear
must match canonical variant/family/age/size and ordinary-tier eligibility. Missing
or duplicate witnesses reject. Durable POLE exemptions apply only when relevant stock
is unregistered; registered zero quantity is not exemption. Later import cannot
invalidate an older paid exemption. Provisional physical handoff stays blocked.

**Capacity addendum.** Physical 95% capacity uses eligible AVAILABLE property-wide
stock before transfer placement, once per strict interchangeable variant pool.
Non-lendable units cannot inflate it. Compatible provisional A/B effective quantities
aggregate before floor(N*.95), retaining per-bucket hard ceilings/provenance. Overlap
may conservatively reject a feasible assignment but cannot borrow restricted supply.

Reserve classification persists across omitted amend/reassign choices and rewrites.
Continuing reserve use reauthorizes current INVENTORY_BUFFER_OVERRIDE and store scope
and appends reason/history. Explicit removal rechecks public capacity. A public
candidate cannot use its authority to reclassify another hold. Staff HOLD and amendment
API/UI expose explicit permission-gated reserve choice/reason and derived capacity;
public parsers reject override fields. AmendmentService is IMPLEMENTED_AND_TESTED,
including exact mode/state acceptance and operational exchange regression.

**D — Cancellation/refund.** Migration 0045 snapshots the 48-hour cancellation policy;
exactly 48 hours qualifies for full refund. Cancellation is terminal and atomically
releases physical/wear/provisional protection and enqueues notification. Settlement
is separate; late payment cannot resurrect inventory. Dispatch commits UNKNOWN first,
never blindly retries, and reconciles only known provider IDs. Staff/automatic refunds
share the collected-payment cap. JA/EN UI requires a current preview and confirmation.

After original guest expiry, verified email recovery issues a separate ten-minute,
booking-specific CANCEL capability. The ordinary read token remains read-only. The
action is HttpOnly, purpose-separated, hash-only at rest, parent-revocation-bound and
idempotent. Read token, wrong booking, expired action, CSRF, unrelated writes and
staff/payment/amendment operations are denied. Response loss recovers one cancellation
and refund; replay never refreshes action expiry. Fresh proof can issue fresh authority.

**E — Resend.** Production uses explicitly injected Resend delivery after identity
validation, sender ZAO Rental <rentalstation@yuge-zao.com>, and existing durable outbox
for confirmation, recovery and cancellation. No fake lookup by idempotency key:
UNKNOWN remains unresolved without evidence and cannot authorize blind resend.
No real email, payment or refund ran.

**F — Publication.** Exact-identity/release-bound PublicationAuthority requires an
explicit PUBLICATION_APPROVED record for https://salomonzao.rent. Environment flags,
forged objects, alternate hosts, queries and private paths cannot publish. JA/EN
metadata/robots/sitemap are dynamic; dark/noindex is the default including APIs.
The existing dark host installs no publication authority. Per-isolate live acceptance
and DNS/indexing/GO remain held.

## Owner-authorized integration corrections

Custody and every actual witness caller receive individually guarded SELECTs on
wear_pools, provisional_capacity_buckets and inventory_pole_exemptions. Real-role
negative proofs deny INSERT/UPDATE/DELETE. Operations' former direct wear-pool writes
now use fixed, session/permission/store-scoped functions with existing conservation
and evidence triggers. Historical prefixes use old-schema fixtures and guarded role
provisioning; runtime services still require current schema. Avatar's availability
role gets only guarded capacity reads and the pure effective-quantity function.

Mode/state is one invariant: Production CONFIRMED/COMPLETED versus development and
Sandbox CONFIRMED_DEV/COMPLETED_DEV. Custody, wear, no-pickup, amendment, manifest,
access/recovery, notifications, projection replay and DB constraints enforce it.
Owned Production-shaped SQL truth reaches preparation, checkout and completion through
the actual operations role; crossed Sandbox/Production states are rejected.

Migrations 0045–0050 and their manifest hashes are included. Existing 0001–0044 remain
unchanged. Production source plan is 0001–0050. No protected governance, verify or
hygiene scripts were weakened.

## Validation and evidence

The Owner-authorized fourth/final `npm run verify` returned raw process exit **0**.
It ran from 2026-09-23T08:47:03.494009Z to 2026-09-23T09:10:06.903743Z.
Evidence: `.local/evidence/2026-09-23T08-47-03.641Z/commands.json` and its command logs.
All **74/74 command groups** ran in the unchanged order and returned exit_code 0.
No tail was skipped. No fifth full run was executed or authorized.

Reference preservation (32 pinned files), secret scan (2,379 candidates), lint,
typecheck, 785 unit tests, macOS controller, all PostgreSQL suites, production build,
all browser groups and final 18-case end-to-end suite passed. This includes capacity,
exact-one witness/POLE, reserve management, cancellation, recovered CANCEL authority,
Resend/outbox, Production-shaped operational roles, restore and historical upgrades.
No live Production identity/provider acceptance is implied by local tests.

The post-run audit verified all 2,258 source-file hashes unchanged during the run,
714 preexisting evidence/backup files unchanged, all 60 existing PostgreSQL clusters
preserved, and all prior ownership records unchanged. All 106 cleanup receipts match
stopped, owned clusters from successful commands and the exact command-log hashes.
No reported failure was hidden by a zero exit. Verify/hygiene scripts, disk guards,
CI/governance and migrations 0001–0044 remain unchanged. Git diff check passed.

Before this full run, all 55 previously unreached tail groups passed individually.
The sweep recorded 28 failed targeted attempts: 25 local fixture/expectation defects
and three local harness defects. Each retains raw evidence and narrow green proof.
Capacity fixtures use adequate local synthetic stock or an explicit staff reserve
path for lower-level mechanics; the product's 95% rule and shared scarcity remain.
Harness corrections preserve both recovery cookies, grant the current-schema local
R15 projector read-only witness access, and include durable capacity/cancellation
records in local restore while revoking bearer capabilities. UNKNOWN refunds retain
their dispatch marker after restore.

Earlier full attempts returned 1 and remain recorded:

1. 2026-09-23T06-07-56.150Z: outdated migration-count expectation; narrow integration
   rerun passed 9 foundation and 21 ledger cases.
2. 2026-09-23T06-10-29.293Z: one-unit pricing UI fixture; local ample-stock correction,
   narrow browser rerun 7 PASS.
3. 2026-09-23T07-39-52.674Z: one-unit alternate recommendation lengths; local two-unit
   fixture correction, narrow browser rerun 10 PASS.

Historical generated Avatar/R15 reports and screenshots from the final run were
archived with hashes in the task outputs. Their tracked historical versions were
restored only after proving the tail-start manifest equalled HEAD for every path.
Product, test, SQL, scripts and configuration were not changed after the full PASS;
only this checkpoint documentation was updated. The final complete closure diff
review found no unresolved BLOCKER/HIGH/MEDIUM issue. A normal release checkpoint
commit and push are authorized; exact remote readback is recorded in task outputs.

The earlier payment harness incident remains explicitly recorded: shutdown reset
its failure exit, so unchanged hygiene deleted the newly created failed cluster
run-HSAX1c in the 05:07:56 run. Its log/ownership/cleanup receipt remain. No preexisting
failed/unconfirmed cluster was removed. Failure exits now occur after shutdown;
the injected negative proof returned raw 1 and disposed zero clusters.

Verified regenerable cache cleanup stopped once required preflight headroom was
reached. Exact directories, per-directory sizes and free-space receipts are in the
task outputs. Required current browsers/dependencies, source, git objects, secrets,
configuration, backup-drill and preserved failure evidence remain. Final full-run
free space: 8,038,477,824 bytes before; 8,085,417,984 bytes after. Disk thresholds are
unchanged. Background APFS changes are not attributed to cache deletion.

## Remaining live gates

See LIVE_GATES.md. Production Neon/schema/roles/credentials, Vercel deploy, real
Square charge/refund, Resend mail, provisional registration, materialization,
backup/Cron/Worker, domain/DNS/indexing, public GO and main merge are not executed.
No release PR is authorized. A green local RC means ready for the single PR/CI step,
not live acceptance or permission to activate services.
