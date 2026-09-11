# Current E05 scope and local operation

Owner: latest 2026-09-11 E05 request and email/password amendment. Work is a human-started
Codex session from merged main `45e838476c8d34d184ac3bc633b7edfdbcde2558`.
PR #4 merged by exact approved head `9a0224fb19d937656360f951635d65028f7278f8`; its final
review snapshot is `4bf47304752af1ed4f41ecb2363266438cbf53daf3a9c83d72b98470359a2a33`.
The squash tree equals the reviewed/CI-tested tree. The separate merge record preserves the
static review's material limits. PR #3 remains Draft, no adoption; Runner UNATTENDED_HOLD.

Implement staff-only accounts, Role/Permission/store scope, login/logout/password change,
minimal staff administration/audit and normal UI/API connection to an owned dev PostgreSQL.
No OIDC or third-party authentication service. No customer signup, refund/price permission
operations, period availability, HOLD, Square, rental/return, production deployment or live Runner.
The original TASKS.json remains historical/planned; this subset does not complete all original
E05 criteria (e.g. future REFUND_OVERRIDE). See ADR 0012 for the single authority on auth decisions.
Ledger business rules remain in LEDGER_SCOPE; the former E05-not-connected statement there is
historical to PR #4 and superseded here. Approx. **300 combined ski+board sets**, approx. 200 wear
pieces are unverified planning totals, not imported records or accepted wear operations.

## Development launch (human terminal, no public tunnel or LAN binding)

1. In this E05 worktree, use Node 24.15.0 / npm 11.12.1 and `npm run setup`.
2. Run `npm run dev -- --bootstrap-admin` in your own terminal. Enter your chosen development
   email and display name, then a 15–128-character password twice at hidden prompts. Do not paste
   credentials into chat, arguments, logs or a configuration file. Nothing is guessed or auto-granted
   by first login. No production ADMIN is created by this code path.
3. Open the printed `http://127.0.0.1:<worktree-port>/staff/login`. Log in with that account.
4. Open `/staff/users`; create a staff account, choose ASSIGNED + its store(s), and explicitly grant
   INVENTORY_EDIT if it should edit. STAFF's default is read-only. Give the initial password to its
   owner through an approved private channel; it is not returned by the app. The staff user can
   change it at `/staff/password`, which signs out every existing session.
5. Bootstrap creates no inventory or customer records. As ADMIN, register synthetic model/variant
   entries in the reused ledger, then let the staff register/update a synthetic Asset in its store.
   Reload, logout and login: data remains in the same running dev DB.
6. Ctrl+C stops this invocation's Web and DB. This existing development strategy uses a **fresh
   disposable cluster per launch**; stop/restart is not a persistence test, and prior data is not
   silently attached. Data directories remain ignored local evidence; do not commit/copy them.

`npm run dev` without the bootstrap flag starts with no staff accounts. Ordinary `next start`
without the owned runtime config fails closed. There are no fixture/login bypass routes and no
ambient DATABASE_URL. No new secret vault or global setting is written. A durable development
DB, production secrets/TLS, staff identity proofing/bootstrap and email recovery need a separate
approved operational setup. This PR does not claim production staff readiness.

## Verification levels

- `npm run verify`: reference + regression, lint/typecheck, real-DB migration/ledger checks,
  production build, `test:auth`, and existing Playwright component/denial tests. No future skips.
- `test:auth` uses the **normal production build**, normal email/password/session handler,
  protected management/ledger APIs and actual PostgreSQL with app roles. Only account/stock
  seed data are synthetic. No mocked identity provider and no test principal is injected into
  the normal runtime. It creates STAFF via ADMIN UI, then staff login/Asset register/update/
  reload/logout/re-login. Disable/expiry/permission/store removal, spoofing, CSRF, hashing,
  account lock, audit and reset-token behavior are separate assertions.
- Existing `tests/ui-app` remains an isolated component fixture transport. It is not evidence
  of DB connectivity. The new normal-flow test is separate from those existing UI tests.
- Browser widths 1280 and 390 are automated viewport checks, not physical phone testing.
  Screenshots use synthetic display names/data. No browser trace/HAR/storageState is saved by
  the auth test. The CI artifact does not include PostgreSQL data directories or passwords.
- No named human account has been registered/tested by Codex. Human acceptance of the local
  login flow is distinct from automated verification. No production email/reset delivery.

Normal physical-record access uses 403 for both inaccessible and absent valid IDs, avoiding
existence disclosure. The core ledger service keeps its internal 404/no-out-of-scope-lock contract.
Unknown resources/malformed requests retain their own status. Denied actions do not enter writes
or unnecessary target row locks.

Independent Claude static review: existing Team, credits OFF; initial once plus at most two
fix/re-review rounds. Only this diff, necessary schema/contracts and sanitized synthetic evidence.
No tools, external retrieval, hooks/plugins/MCP automatic context or PR #3 adapters. Exact head,
manifest/hash and CI integration commit must match; failures and limits are never PASS.
Stop at the new Draft PR with evidence. No E05 PR merge.
