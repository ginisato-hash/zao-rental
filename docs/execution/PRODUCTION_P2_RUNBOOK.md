# P2 operations and launch gates — no release authority

## Current use and evidence

Run `npm run setup` then `npm run verify` inside this dedicated worktree. `npm run test:integration-p2` executes synthetic guest/ingress/DB and stopped-cluster restore tests; `npm run test:asset-reader` covers fixture camera/slow/offline/touch/reload. These commands bind127.0.0.1, use unique worktree DB/port/seed, and stop owned resources. No model, provider, external alert or production traffic. Public normal runtime/robots remain closed for production. See PRODUCTION_P2_STATUS.json and the Draft PR for exact head/CI/review.

## Guest startup/release plan (not executed)

1. Owner approves all eight numeric guest policy fields and version, legal retention scope and recovery-loss support procedure. No values in pending config are inferred.
2. Hosting operator supplies a verified dispatcher/socket adapter and secret resolver through existing approved deployment systems. Proxy headers alone are insufficient. Establish same canonical peer, DB and key across replicas, edge limits and capacity tests.
3. Parse ZAO_PRODUCTION_GUEST_CONFIG using the schema/runtime inequalities. Match its SHA-256 against the separately approved release record. Parse ZAO_PRODUCTION_SECRET_METADATA (IDs only); reject absent/expired/revoked keys, duplicate active keys and public secret variables.
4. Compose GuestSecurity; immutable policy/version and startup audit must succeed before traffic. Do not treat `productionActivation:false` or approval digest as an HTTP override. Real runtime wiring and release require separate approval.
5. Rollout/rollback must preserve old active contexts or intentionally revoke them with an approved incident policy. Never silently change retention/TTL under an old policy version; no automatic TTL extension.

## Secret lifecycle

| Purpose | Rotation and old-key grace | Revocation / verification |
|---|---|---|
| DB | Provision separate least-privilege credential through approved provider; new pool health/role checks, drain old pools, then revoke old login. Migration identity separate. | Revoke compromised login, close affected pools, verify no old connection; never print DSN/password. No real rotation executed. |
| Square access | Verify Sandbox merchant/location before use. Resolve current unrevoked key for each operation; old token needed only for in-flight provider requests. | Authentication failure STOP; UNKNOWN lookup against same persisted attempt/provider ID, never re-charge under a new key. |
| Square webhook | Future bounded current+retiring verifier IDs for previously delivered events; grace tied to actual provider retry and reconciliation policy. | Revoked keys never accepted. Current single-key verifier is not a dual-key rotation implementation. Key overlap duration needs owner/provider evidence. |
| Storage | Rotate provider credential and signed-ticket key according to provider; preserve or explicitly revoke outstanding tickets and purge CDN. | Private ticket URLs are secrets, never logged. Confirm matching purge acknowledgement; null legal retention forbids deletion. |
| Guest recovery | Current P1 single-key HMAC replay requires the same key for the existing replay window. Coordinated drain/stop new recoveries, await outstanding replay window, then rotate; do not promise transparent overlap. | Existing context token hashes remain authoritative; unsafe key changes can break identical-response replay. Dual-key/key-ID persistence is not implemented. Compromise response needs explicit context revocation plan and approval. |

No secret value appears in metadata/config/examples. Use existing approved storage only; no .env/Keychain extraction, chat paste, public-prefix values or fresh credentials. Failed startup logs code/metadata IDs only. Trace/HAR/dumps can contain secrets and are excluded from evidence; create sanitized summaries.

## Backup/restore and migration

Drill: stop only owned source → per-file digest cold backup → reject corruption before startup → copy to fresh empty target → same-major PostgreSQL start → compare all table counts/digests, migration checksums and original snapshot rows → migration replay → intentionally failed transactional DDL rollback → pool disconnect → cluster stop. Backup bytes never go to CI artifacts/review/Git.

Production checklist: separately approved backup/PITR provider and encryption/key access; retention and RPO/RTO; maintenance/drain boundary; pre-migration verified backup; restored schema/constraints/roles/audits/stock/payments; application compatibility; alert delivery; operator signoff. Never restore over current data or run blind down migrations. Failure stops release; preserve diagnostics without row bodies. Roll application back only to schema-compatible code. The local cold drill does not validate provider restore, cross-major upgrades, off-site durability or realistic-size timings.

## Observability and incident responses

`productionEvent`/`reportProductionEvent` accepts only schemaVersion/code/requestId/time/releaseSha/retryDisposition. Sink is an injected interface, not an installed service. Codes: PAYMENT_UNKNOWN, WEBHOOK_FAILED, INVENTORY_INVARIANT_FAILED, GUEST_RECOVERY_ABUSE, RATE_LIMIT_SATURATED, MIGRATION_FAILED, BACKUP_FAILED, CUSTODY_INCONSISTENT, STORAGE_FAILED. Tests prove all nine reach a fixture sink and unknown/private fields are refused. Provider/normal production event emission, alert routing/delivery, on-call ownership and retention remain unconnected. Do not label fixture sink tests as delivered production alerts.

UNKNOWN: reconcile same attempt. Stock/custody invariant: stop affected action, preserve receipt facts, no arbitrary stock release. Guest abuse/rate: deny safely without revealing recovery validity; do not cycle keys to evade limits. Backup/migration: stop release. Storage: deny inaccessible media; do not expose originals as fallback.

## Remaining owner/external gates

| Gate | P2 evidence | Required next action |
|---|---|---|
| Guest numeric policy / legal retention | Schema, immutable PG version, startup audit and two-pool tests; synthetic values only | Owner values + protected release digest; submitted data retention/deletion policy |
| Trusted ingress | Out-of-band Request binding; spoof/alias/shared limiter fixtures | Provider choice, verified channel/edge controls and deployment tests |
| Square Sandbox | Concrete transport fixtures + unchanged gateway/state-machine PG regression | Explicit connection authority/credentials/tokenization/merchant/location/webhook URL and actual Sandbox E2E |
| Storage/CDN | Private/digest/rights/ticket/purge/deletion contract tests | Provider/contract/credentials; actual immutable put/signed retrieval/revoke/purge tests |
| Catalog/stock | Source staging/unresolved/exact match/dry-run | Real Salomon docs/photos/receipts, rights, model/season/variant, units/store breakdown; separate real import approval |
| Commercial/legal | All pending values stay null/owner-pending | Tax, season, coupon, cleaning times, NAP, cancel/refund/delayed-pickup final wording, media rights |
| Main protection | Recorded protected=false; settings not changed | PR required, exact required CI checks, direct-main restrictions, review policy decision |
| Deployment/backup/secrets/alerts | Local restore + schemas/runbooks/fixture sinks | Target/domain/provider, RPO/RTO, encrypted restore/rotation/alert drills, final release approval |
| Actual devices/CWV | Synthetic camera, touch/width matrix and LAB/FIELD contract | Real iPhone Safari/Android Chrome/tablet/camera/field Wi-Fi, rotation/background, measured CWV |
| SEO external work | JA/EN initial HTML/canonical/hreflang/robots/sitemap/JSON-LD/noindex regression | Public release first, then Search Console/GBP/Zao listing applications |

No new business conditions: preserve prior scope, pair Assets, quantity wear, prices, 600s HOLD, hours, same-day exclusion, Premium promise, original contract on late pickup, no unused-day refunds. No production, actual data, provider requests, extra costs, host rights, new PR merge or Runner activation.
