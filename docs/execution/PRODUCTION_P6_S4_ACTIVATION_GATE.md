# S4 live Sandbox activation gate — NOT execution authority

R11 local implementation only. Read `PRODUCTION_P6_S4_LOCAL_AUTHORITY.md`,
`PRODUCTION_P6_STATUS.json` and `p6/s4-local/RESULT.md`. R10 remains
`S3_NONTERMINAL_DO_NOT_RETRY` / `LAST_OBSERVED_PENDING`. Refund finalization is
`DEFERRED_NON_GATING_FOR_LOCAL_IMPLEMENTATION`; this gate never permits another refund lookup.

## Implemented route / receive contract

`POST /api/webhooks/square` (Node.js, dynamic). Other methods 405 / Allow POST;
no UI link, sitemap entry, prefetch or browser dependency. No-store responses.

1. Read body stream once, bounded to 65,536 bytes (actual bytes, independent of Content-Length).
2. Existing `verifySquareWebhook`: HMAC-SHA256 of **configured exact notification URL + unchanged raw bytes**,
   constant-time comparison with `x-square-hmacsha256-signature`. No request-derived URL authority.
3. Only after verification: strict UTF-8 / JSON, bounded identifiers and merchant validation.
4. `payment.created` / `payment.updated`: persist event metadata plus exact raw-body SHA-256 through
   `square_webhook.receive`, and await explicit COMMIT (`synchronous_commit=on`) before 200.
5. No provider lookup, payment/refund, booking, inventory, custody, notification or scheduler call.

| Condition | HTTP / persistence |
| --- | --- |
| Missing/disabled config, Production composition | 503; no pool |
| Signature absent/invalid | 403; DB calls 0 |
| Actual body over 64 KiB | 413; DB calls 0 |
| Unreadable body / malformed verified payload | 400 / 422; DB calls 0 |
| Signed merchant mismatch | 403; DB calls 0 |
| Accepted payment event committed | 200 RECEIVED |
| Same environment + event ID + exact raw hash | 200 DUPLICATE after committed DB result |
| Same ID, different hash/metadata | 409 EVENT_HASH_CONFLICT; original immutable fields retained;
 bounded conflict count/time/latest hash committed; unprocessed row BLOCKED and lease invalidated |
| DB acquire/insert/commit failure or uncertain commit | 503; no application retry; provider may redeliver same ID |
| Unsupported event with valid signature, envelope and correct merchant | 200 IGNORED_UNSUPPORTED_EVENT;
 **explicit non-payment ACK exception**, no durable row or business action; avoids permanent retry loops |

Unsupported events still need event_id/merchant_id/type; no payment.id is required for these ignored
non-payment events. Payment events require payment.id. Retry count/reason headers neither bypass
signature checks nor grant processing authority. Different formatting means a different raw hash.

## Storage and future reconciliation

`0025_square_webhook_inbox.sql` adds isolated schema `square_webhook`; 0001–0024 unchanged.
Inbox PK `(environment,event_id)` permits reuse of the primitive across separate Sandbox/Production
identities. Only Sandbox is composed in the route. Accepted event_type, merchant_id, payment_id,
body_sha256, received_at, state, attempts (0–5), lease UUID/deadline, retry-at, processed/reconciled time,
bounded conflict metadata and enumerated error classes are retained. No raw payload, signature,
credential, card/customer data, cookie or provider body column.

`receive` grants no UPDATE/DELETE API for original signal fields. `claim` selects one eligible row
with FOR UPDATE SKIP LOCKED, issues a fresh UUID lease (5–300 seconds), and increments attempts.
Expired leases may be reclaimed; fifth exhausted claim becomes BLOCKED on the next claim pass.
`settle` locks then samples the DB clock; wrong/expired lease tokens cannot settle. Retry delay is
1–3600 seconds; attempts cap at 5. BLOCKED needs future explicit operator policy, not automatic reset.
RECONCILED stays historical even if a later hash conflict is audited.

There is **no worker**, automatic polling, provider reconciliation invocation or business mutation.
Future reconciliation must fetch the latest provider Payment and revalidate environment, merchant,
location, payment/reference, currency/amount and existing payment state-machine rules. Webhook order
and payload status are not truth. Lease fencing here protects the inbox mark only; a future business
update must separately have an idempotent/fenced transaction boundary. Do not equate RECONCILED
with reservation confirmation. No metadata purge/retention job is introduced; preserve dedupe
records until an explicitly reviewed retention policy exists.

## Owner authority needed before any live step

A single next authority can specify the approved deployment, isolated Sandbox DB/migration and
receiver role, Preview-only secrets, supported protected ingress, subscription, delivery/replay
budget, evidence and cleanup. Without it all following steps remain ACTIVATION_PENDING_OWNER_LOGIN.
No new model, daemon or global authentication work is implied.

1. **DB before ACK**: authorize and provision a dedicated Sandbox test DB; apply the additive migration
   only there; verify migration drift detection and recovery. R11 did not connect to any PostgreSQL.
   Do not reuse staff/migration credentials in the receiver.
2. Dedicated `zao_square_webhook_receiver` login: NOSUPERUSER/NOCREATEDB/NOCREATEROLE/NOINHERIT/
   NOREPLICATION/NOBYPASSRLS, only CONNECT to the approved DB, USAGE on square_webhook,
   EXECUTE on `square_webhook.receive(text,text,text,text,text,text)`.
   No direct table SELECT/INSERT/UPDATE/DELETE, no business grants, no schema creation/ownership.
   Migration revokes PUBLIC and intentionally grants no existing runtime role.
   A separately approved reconciler role would receive only USAGE + claim(text,integer) and
   settle(text,text,uuid,text,text,integer), not receiver or business authority automatically.
   Apply/verify grants only under that later authority, including inherited PUBLIC access checks.
3. Secret store: Owner enters values directly in approved Preview-only secret storage. Never chat,
   repo, PR, command output, env pull or screenshots. Runtime requires:

| Environment name | Requirement (no real values in this document) |
| --- | --- |
| ZAO_SQUARE_WEBHOOK_ACTIVATION | SANDBOX, only after activation approval |
| VERCEL_ENV | preview platform metadata; production rejected |
| SQUARE_ENVIRONMENT | SANDBOX |
| SQUARE_API_VERSION | 2026-08-19 |
| SQUARE_SANDBOX_MERCHANT_ID | MLKDVEDH1ME21 adopted Sandbox identity |
| SQUARE_SANDBOX_NOTIFICATION_URL | exact approved HTTPS Preview URL + `/api/webhooks/square`; no query/fragment/userinfo |
| SQUARE_SANDBOX_WEBHOOK_SIGNATURE_KEY | sensitive, Preview-only; not access token |
| SQUARE_WEBHOOK_DATABASE_URL | sensitive; dedicated receiver login; no URL query/fragment; verified TLS forced |

Square access token, application ID and location ID are **not** receiver dependencies. Public
NEXT_PUBLIC settings are rejected by the composition. No alias/production credential fallback.
No above values were created, retrieved or validated against external systems in R11.

4. **Protection/ingress unresolved**: keep Vercel Deployment Protection. Square cannot perform an
   interactive Vercel login. Before subscription, establish an Owner-approved, provider-supported
   machine delivery path for this exact webhook route while retaining protection elsewhere and HMAC
   validation. No blanket protection disable, secret URL query, bypass-cookie export or inferred
   header bypass. If the selected Protection setup cannot support this, stop activation and record
   the missing ingress decision; do not claim successful delivery from a protected login response.
5. Authorize one exact protected Preview deployment and record immutable URL/deployment/head/tree;
   verify fail-closed startup with missing config, then the approved configuration. No Production alias.
6. Owner opens Square Developer Dashboard → correct existing Sandbox application → Webhooks →
   new **Sandbox** subscription. Match adopted merchant, set exact approved URL/version,
   select only payment.created/payment.updated. Owner transfers signature key directly to secret store.
   Record metadata only (subscription ID, event names, URL, version, signature-key presence).
7. Enable/verify only after DB and ingress checks pass. Live test deliveries and any necessary new
   synthetic Sandbox payment require an explicit count/budget. Never reuse R10 as refund authority.

## Mandatory live acceptance evidence (all NOT_RUN in R11)

- Actual PostgreSQL apply plus strict role-denial tests; unauthorized table/business writes denied.
- Two DB connections racing same event: one row; same-hash duplicate ACK; conflicting hash audited,
  original preserved; transaction rollback and dropped COMMIT response recover by same event ID.
- ACK only after durable COMMIT/WAL; restart app and read the stored row. DB outage yields 5xx.
- Two workers claim: no simultaneous live claim for one row; expire/replace lease via test clocks or
  synchronization, stale settlement rejected, final-attempt crash becomes BLOCKED; no long sleeps.
- Real Square signature (including raw whitespace/URL), actual delivery receipt; no fixture-as-live claim.
- Replay exact event ID/hash, wrong signature, wrong merchant, unexpected event scope safely classified.
- Out-of-order acceptance: record updated and created as signals without regressing payment truth;
  provider reconciliation remains a separate future activation, not a hidden side effect of ACK.
- Sanitized deployment/head/tree + subscription metadata, response classifications/status/time,
  event IDs/payment IDs/body hashes, DB row count/state; no raw body/signature/token/headers/PII.
- Confirm Production disabled, S1/S2/R10 not repeated, reservation/inventory/custody mutations 0.

R11 evidence is fixture/static and secretless build only. No real DB enforcement, actual Square
signature/delivery, Vercel ingress, worker crash process, HA durability or production readiness claim.

## Cleanup and retained evidence

Under the next explicit authority: stop/pause exact temporary subscription and activation flag,
stop owned test resources, remove only the accepted temporary Preview if specified, retain durable
inbox/dedupe and sanitized evidence. Do not delete provider payment/refund objects or R10 records.
Record uncertain results without blind retries. Retain R3 and other unrelated resources unchanged.
Production remains disabled and requires separate approval.
