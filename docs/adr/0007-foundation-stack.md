# ADR 0007 — Executable local Web/PostgreSQL foundation

Status: implemented development foundation, pending independent review and owner integration.
Decision date: 2026-09-11 JST. Official sources and installed environment were checked during this run.

## Stack and reproducibility

| Component | Pin | Evidence / reason |
|---|---|---|
| Node / npm | 24.15.0 / 11.12.1 | installed on this Mac; Node 24 LTS; .nvmrc/engines/CI pinned |
| Next.js / React | 16.3.4 / 19.3.0 | official registry peer metadata; Node >=20.9 and React 19 supported |
| TypeScript | 5.9.3 | conservative compiler compatible with Next's >=5.1 floor; no TS7 migration required |
| ESLint / Next config | 9.39.3 / 16.3.4 | Next bundled React/import/a11y plugins require ESLint 9; actual ESLint 10 lint failed |
| ORM / driver | Drizzle 0.45.2 / pg 8.23.0 | SQL-visible migration and typed PostgreSQL access, no extra service/credentials |
| PostgreSQL | 18.4 | actual native PostgreSQL process, not an in-memory SQL emulation |
| Local PG launcher | embedded-postgres 18.4.0-beta.17 | dev-only beta wrapper; exact npm lock; binaries from upstream package |
| TS runner / browser tests | tsx 4.23.13 / Playwright 1.63.0 | Node test runner + browser traces, no retries |

The host reports arm64; the packaged PG process reports x86_64-apple-darwin24.6.0 and PostgreSQL 18.4.
This is the observed execution path (macOS translation), not proof of a native arm64 PG binary.
No Docker/psql/host PG service was on PATH; no shared Homebrew service, host user or scheduler is installed.
Linux CI uses the same lockfile launcher on Ubuntu 24.04. Compatibility is established by actual
setup/migration/integration/build and CI; the wrapper beta is an explicit development dependency risk.
ESLint 9.39.3 emits a support-ended warning. ESLint 10.10.0 was tried without force/legacy-peer-deps,
but Next bundled eslint-plugin-react failed at getFilename and npm ls reported invalid peers.
Pin 9 for the current plugin matrix, retain every rule, and track the lint ecosystem update before
production. This is documented toolchain maintenance debt, not a hidden test exemption.
The initial npm 11.12.1 and Node pins are intentional, not claims to be the latest release.

One root package/lockfile contains `apps/web`, `packages/contracts`, `packages/core`, `packages/db`.
These are source module boundaries, not separately deployed services. Build uses webpack explicitly
for deterministic initial cross-environment verification. Build does not connect to a DB or publish prices.

## Database isolation and migrations

Canonical absolute worktree path hashes to DB name, DB role, port pair and seed namespace. Each
invocation creates a fresh cluster under `.local/postgres/run-*`, SCRAM password in memory and
loopback-only TCP with Unix sockets disabled (avoids long-worktree-path socket limits). No DATABASE_URL is accepted. Role credentials are generated per invocation
and are never logged or stored in repo configuration; initdb briefly uses a launcher-managed
password file under the OS temporary directory, forced owner-only by umask 077 and unlinked in finally; no production secrets are needed. Since each cluster is exclusively
owned, its bootstrap role is local superuser; production application roles/least-privilege migrations
remain E05 work. Port collision fails, and no process outside this invocation is stopped.

The single SQL migration creates metadata + event tables with constraints. A transaction and
advisory lock serialize migration application; checksums reject edited history. This small explicit
migrator is intentionally one migration, not an automatic glob-based migration framework. Add a versioned
ordered migration mechanism before adding a second schema revision. Tests prove concurrency,
idempotence, FK/check constraints, rollback, checksum drift and password rejection against real PG.
Seed includes only a namespace and version. No production catalogue, prices or inventory are loaded.
`recordTelemetry` accepts only two foundation event names, no arbitrary payload/PII. Runtime business
analytics, role-separated immutable audit and long-term storage are future work.

## Authentication

Next official guidance recommends maintained auth/session libraries and authorization near data access.
Future E05 direction: maintained OIDC library, server-managed secure session, explicit server-side role
mapping and audited staff permission grants. Provider/tenant and provisioning require owner input then;
no paid hosted auth is selected now. E01 `getPrincipal()` returns null on the server. Staff/admin API
routes always return 401; forged headers/cookies never become principals. HTML shows an unavailable
state and no privileged data. The pure role predicate is unit-tested; that is not real authentication.
Do not connect real staff/customer data or deploy publicly before E05 completes.

## Official sources checked

- [Next installation and requirements](https://nextjs.org/docs/app/getting-started/installation)
- [Next authentication and authorization](https://nextjs.org/docs/app/guides/authentication)
- [Node release support](https://nodejs.org/en/about/previous-releases)
- [Drizzle node-postgres integration](https://orm.drizzle.team/docs/get-started/node-postgres)
- [PostgreSQL support policy](https://www.postgresql.org/support/versioning/)
- [PostgreSQL initdb options](https://www.postgresql.org/docs/18/app-initdb.html)
- [Launcher maintainer's documentation](https://github.com/leinelissen/embedded-postgres)

Version metadata was also read from the official npm registry and pinned by integrity in package-lock.json.

## Linux CI shutdown correction

The first Linux CI completed all seven DB assertions but failed on pg-pool idle-client error 57P01
during shutdown. Inspection showed pg-pool removes idle clients and resolves pool.end before their
physical socket end callbacks. The owned server could therefore stop too early. Track every connected
client and await its end event before stopping PG; background pool errors become a sanitized failure,
not a dumped Client object. Regression tests model the delayed socket close and confirm errors remain
failures without revealing connection metadata. No sleeps/retries/error suppression were added.

## PR #1 independent-review follow-up: migration recovery

The original event INSERT/ROLLBACK test did not exercise a failed migration. A separate fresh owned
PostgreSQL cluster now forces the initial migration to fail after its first DDL, using a test-owned
name collision. The integration test verifies both migration-created relations are absent, preserves
the collision fixture, probes advisory-lock release from a different reserved backend, removes only
its own fixture, then applies/replays the migration and writes a valid seed/event. The original fresh
concurrent-migration test remains separate. This adds failure-recovery evidence without changing the
migration SQL, schema, pricing or operational rules.

The first re-review accepted D1/B1 and identified a LOW test weakness: SET statement_timeout on one
leased client did not guarantee a later pool checkout inherited it. The recovery cluster now receives
statement_timeout through the Pool constructor for every physical connection; default dev/test calls
remain unchanged. A real-PG test holds two distinct backend PIDs, verifies each reports 5s, confirms
pg_sleep(6) is cancelled with SQLSTATE 57014 on each, and checks each connection still executes SELECT 1.
All concurrent checks settle before clients are released or the owned cluster stops. No wall-clock
assertion, statistical pool reuse, retry or skip is used. See the [pg client config](https://node-postgres.com/apis/client)
and [Pool constructor inheritance](https://node-postgres.com/apis/pool).
