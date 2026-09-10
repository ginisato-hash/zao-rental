# ZAO Rental — E00 / E01 foundation

One private Next.js app with customer/staff/admin entrypoints, fail-closed authorization,
real PostgreSQL migrations and isolated verification. Booking, pricing publication, inventory,
Square and real user authentication are not implemented. Business rules remain bootstrap v0.4.

## Run on a fresh clone or worktree

Prerequisites: Node **24.15.0**, npm **11.12.1**, Python 3, Git; macOS (tested) or Ubuntu 24.04 (CI).
No Docker, shared PostgreSQL, production account or API key is needed.

```sh
npm run setup
npm run verify
npm run dev
```

`setup` uses the exact lockfile and installs Chromium under `.local/browsers`. On a minimal
Linux machine, additionally run `npx playwright install-deps chromium` with the machine owner's
permission; CI installs these system libraries in an ephemeral runner.
`verify` writes command/exit-code logs under `.local/evidence/<run-id>/` and stops on the first failure.
`dev` starts a private, fresh PostgreSQL cluster and Web process; Ctrl+C stops owned processes.
It prints only the localhost URL and a non-secret seed namespace. This dev database is disposable;
no business data should be stored. No daemon or scheduler is installed.

The canonical checkout's current web port is 36881 and DB port 26881. Other worktree paths derive
different ports/database/user/seed namespaces; a collision fails closed, never attaches to or
kills an existing service. `.local/postgres/run-*` preserves disposable data for investigation;
no automatic stale-process takeover or deletion is performed. Unset all ambient PG/DATABASE_URL
variables to avoid accidentally inheriting another application's database.

## Individual verification

```sh
npm run check:reference
npm run check:secrets
npm run test:reference
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm run build
npm run test:e2e
npm run runner:dry-run
```

Use `PLAYWRIGHT_BROWSERS_PATH=.local/browsers npm run test:e2e` for standalone E2E; setup/verify
set it automatically. E2E uses the built app, retries=0, no reuse of a running server.
The 27 Python tests verify supplied configuration/document consistency. The 32 documented
operational scenarios remain **unimplemented / unexecuted**, with no skip placeholders.

## Review map

- [Working contract](AGENTS.md) / [independent review](CLAUDE.md)
- [Scope and authority](docs/execution/SCOPE.md)
- [Stack, database and authentication decisions](docs/adr/0007-foundation-stack.md)
- [Runner and review trust boundaries](docs/adr/0008-runner-review-boundaries.md)
- [Execution evidence and gaps](docs/execution/CURRENT_STATE.md)
- [Acceptance traceability](docs/execution/TRACEABILITY.md)

E02's executable CLI is **simulation only**. `--live` exits 2; it cannot invoke models, push, merge
or deploy. The Claude Action proposal has a literal `if: false`, no schedule and no credentials
provisioned. Do not mistake its skipped job for a review. Main requires human review/merge;
server-side branch protection was unavailable to this private repo (HTTP 403). No plan change was made.
