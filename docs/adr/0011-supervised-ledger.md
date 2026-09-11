# ADR 0011 — supervised E03 ledger contracts and E04 implementation

Decision: 2026-09-11, explicit owner priority change. Start from merged main
`be8c50ad35abefb6f95e45e5e4b1a7da37650176` in a separate worktree. Leave PR #3
(`6d0ec6341d2f67579ef8ed74c4b47a8155c32bf3`) Draft with its evidence/gaps untouched.
No merge/cherry-pick/dependency on PR #3, infrastructure installation or live Runner call.
The unattended Runner stays UNATTENDED_HOLD. Its policy, controller and task dependency checks
are unchanged. Owner-started development is separately authorized; this does not satisfy E02.

## Scope and current business authority

This delivers the ledger subset of E03 and E04. The precise current contract and verification map
are in `docs/execution/LEDGER_SCOPE.md`; progress is in `LEDGER_PROGRESS.json`. Original TASKS.json
and bootstrap specifications remain historical, checksum-verifiable inputs. In particular their
500-set references are superseded for planning by the owner's combined approximately 300 ski/board
sets and approximately 200 wear items. No claim that detailed physical stock is verified follows.
E03 time/money/interval counterexamples and the rest of E05–E18 are not completed by this ledger.

## Implementation choices

Keep the pinned Next/React/TypeScript, Drizzle/pg and existing PostgreSQL launcher. The explicit
migrator now has a fixed ordered registry, validates the complete applied checksum prefix under
the same transaction/advisory lock, and applies the pending batch atomically. 0001 SQL is unchanged.
An actual failed 0002 upgrade test preserves 0001 data and validates recovery/lock release.
SQL owns cross-table constraints and the ledger read view; typed parameterized pg transactions
use the existing driver alongside the existing Drizzle foundation, without an ORM replacement.

Separate models, immutable size/age/tier variants, physical Assets, size/store/status pole pools,
and commercial bundles. Bundle components are a read-only requirements view of the bundle family;
they cannot INSERT assets or quantities. UUIDs are opaque and store-independent. A ski pair has
one Asset/ID with two copies of the same label. The same provenance row cannot be entered twice
within the same resource; a model and an Asset may deliberately share one citation. The resource is part of the provenance identity.
This cannot detect a human registering the same physical pair under two newly invented source
records; physical intake/label reconciliation remains a later staff procedure, not a claimed AI check.

Basic edits cannot change IDs, variant identity, source or custody. Initial store history is
inserted with the Asset. Transfers are intentionally not implemented; no editable current-store
shortcut exists. DB triggers append before/after audit records for committed changes; optimistic
versions reject lost updates. The triggers reject direct history edits/deletes and unsupported
entity deletion. This is not protection from a database superuser disabling triggers. Production
DB-role/RLS and authentication deployment remain E05 work; isolated dev clusters retain the
existing temporary local role model. Audit actor identifiers are opaque, not customer/email data.

Ski-boot BSL is either unverified/null or explicitly recorded with a source. 1–999 mm is an input
storage sanity bound, not a fit or safety range. Snowboard boots use NOT_APPLICABLE/null. Recording
BSL never changes status, calculates DIN, certifies compatibility or infers a value from shoe size.
AVAILABLE is only a physical ledger status displayed as 点検済み; no route computes reservable stock.
Wear can be a model kind, but no wear variant/Asset/bundle or selling switch is enabled pending unit
decisions. No price, booking, HOLD, transfer or Square path is added.

## Authentication and UI test boundary

Every production ledger API resolves getPrincipal() first. It remains null. Anonymous and forged
header/cookie requests stay 401 and never construct storage. Services require STAFF/ADMIN plus
explicit verified store scope; writes require ADMIN. No wildcard admin, test-auth flag or ambient
DATABASE_URL is accepted. E05 must connect the server-verified principal and a separately provisioned
runtime DB connection. The production runtime's DB factory deliberately returns STORAGE_NOT_CONNECTED;
this PR does not claim that real staff can log in or use the ledger.

The real PostgreSQL tests inject a trusted synthetic principal into the same HTTP adapter and
service constructor. Only tests construct that identity. The React components are exercised in a
separate `tests/ui-app` Playwright server with a fake in-memory transport and clearly labeled
synthetic fixture. It is not a route, build flag or login mode in apps/web. Production build routes
and denial E2E prove that separation. Component screenshots demonstrate rendering/interaction,
not live authentication or browser-to-DB integration. Both DB/API and component evidence are needed.
No background daemon or detached process is added: the existing owned DB launcher and Playwright
webServer lifecycle start and stop only this worktree's temporary processes.

Sources checked for constraints/triggers and data-layer authorization:
[PostgreSQL constraints](https://www.postgresql.org/docs/18/ddl-constraints.html),
[PostgreSQL triggers](https://www.postgresql.org/docs/18/sql-createtrigger.html),
[PostgreSQL generated columns](https://www.postgresql.org/docs/18/ddl-generated-columns.html),
[Next authentication](https://nextjs.org/docs/app/guides/authentication).
