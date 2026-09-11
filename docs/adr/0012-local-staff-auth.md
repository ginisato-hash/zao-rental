# ADR 0012 — Supervised E05 local staff accounts

Status: accepted implementation direction from the owner's 2026-09-11 E05 amendment;
verification/independent adoption are evidenced for the associated Draft PR head.
Supersedes only the future OIDC direction in ADR 0007 and LEDGER_SCOPE. No IdP, external
OAuth application, Workspace assumption, hosted auth contract, or email provider is introduced.

Use Better Auth **1.7.4**, compatible with the pinned Next 16 / React 19 / Node 24 / pg 8
stack. Reuse its PostgreSQL adapter, credential verification flow, random database sessions,
Cookie signing, CSRF checks, password change and one-use reset-token consumption.
Password hashing uses its documented hash/verify extension with **@node-rs/argon2 2.2.1**:
Argon2id v19, memory 65536 KiB, time 3, parallelism 1, 32-byte output and library-generated
salt. This follows the owner's Argon2id preference without implementing a KDF. Library-default
scrypt is not an existing deployed credential format here. Length is 15–128 characters;
no composition rules, password plaintext persistence, command-line password, or password log.

`staff_users` is a unified **SQL view**, not a duplicate credential table: Better Auth owns
`auth_user` (canonical email/display name), `auth_account` (one credential `password` hash),
and `auth_session`; `staff_members` owns active/Role, timestamps and failure/lock state.
The view exposes the requested id/email/password_hash/display_name/active/role/created_at/
updated_at/last_login_at/password_changed_at fields plus failed_login_count/locked_until.
No application role may SELECT this hash-bearing view. Management lists explicitly select
non-secret columns. Canonical email is ASCII email syntax, trim + lowercase, with DB UNIQUE
and canonical CHECK; provider-specific alias merging is not performed. Email is an account
identifier provisioned by an authorized administrator, not a verified external identity claim.

Role defaults and explicit allow/deny overrides are separate tables. Default permission rows:

| Role | Default permissions |
|---|---|
| ADMIN | INVENTORY_VIEW, INVENTORY_EDIT, STAFF_MANAGE |
| MANAGER | INVENTORY_VIEW, INVENTORY_EDIT |
| STAFF | INVENTORY_VIEW |
| VIEWER | INVENTORY_VIEW |

An explicit deny wins over a default; an explicit allow can extend a role's defaults.
`staff_store_access` is independent of Role. ALL scope is a separate explicit grant,
otherwise only assigned MOUNTAIN_BASE / ONSEN_BASE rows are visible. INVENTORY_EDIT permits
physical stock edits within that scope; global model/variant/bundle edits additionally need
ALL scope. Staff management requires ADMIN + STAFF_MANAGE + explicit ALL scope. Own access
cannot be edited in the management API; password changes have a separate authenticated path.
PRICE_EDIT and REFUND_OVERRIDE are not implemented or automatically granted. E05's original
future refund-permission criterion therefore remains outside this owner-approved subset.

Each protected request resolves the Better Auth DB session and rereads active state,
permissions and store rows; no JWT/cookie permission cache. Sessions have an absolute eight-hour
lifetime without refresh. HttpOnly, SameSite=Lax, Path=/; Secure when the configured origin is
HTTPS. The only supplied runtime is an owned HTTP **127.0.0.1** development launcher, so its
Cookie correctly is not Secure. A real-library/DB test also verifies Secure cookie attributes for an in-memory HTTPS request;
this is not a network TLS test. Production/TLS/proxy operation is not provisioned or verified.
Mutations require the exact configured Origin and bounded JSON; no client-selected redirect,
Role, actor or scope can authenticate the caller. Closed/unknown auth endpoints return 404.
Public signup and social login are disabled at both routing and library configuration.

Five failed attempts lock a known account for 15 minutes, serialized by a DB advisory lock
across processes. Lock waiters have a separate bounded pool, so they cannot exhaust the
authentication adapter connections needed by the winning login. Better Auth also limits sign-in requests to 30/minute per detected client in
this single-server runtime. This is not a tested multi-node/public-edge rate-limit deployment.
Account disable and password change revoke sessions in database triggers. Password change
requires the current password, revokes **all** sessions, and requires re-login. Browser views
unmount on logout, session change, hidden-page return and permission mismatch; a visible page
also revalidates every 15 seconds. APIs reject revoked permissions on the next request. An
already completed authorized read cannot be recalled from a human's memory or screenshot.

Reset uses Better Auth's 24-character random token, 15-minute expiry, hashed verification
identifier and atomic consume. Real email delivery is **not connected**: no public reset request
route or token logging. The service callback is exercised with an in-memory development-test
delivery; completion uses the normal protected-origin endpoint. This is not a usable production
email recovery service. Bootstrap and recovery procedures must be approved before production.

Migration 0003 adds only E05 tables/views/triggers and restricted audit execution. 0001/0002
remain unchanged. The owned cluster migration connection is never given to Next. The auth
connection has only credential/session/staff CRUD plus append-only audit function access;
the ledger connection cannot access credentials, DDL, role management, staff writes or audit
writes. Trigger-owned ledger history inserts use a fixed search_path SECURITY DEFINER function.
These are trusted-server application roles, not per-human PostgreSQL roles or a production RLS
claim. No production DB connection is accepted by the development runtime.

Audit event metadata is event type, server-verified actor/target IDs and timestamp only. Never
password, reset/session token, OAuth response, SQL connection secret or request body. Anonymous
LOGIN_FAILED has no verified actor; target is a known staff id if one was found. Administrative
changes use the current server principal as actor within their transaction.

Sources checked 2026-09-11, plus installed package declarations/source:
- [Better Auth email/password](https://better-auth.com/docs/authentication/email-password)
- [Better Auth Next integration](https://better-auth.com/docs/integrations/next)
- [Better Auth PostgreSQL adapter](https://better-auth.com/docs/adapters/postgresql)
- [Session management](https://better-auth.com/docs/concepts/session-management)
- [Security](https://better-auth.com/docs/reference/security)
- [Argon2 library and parameters](https://github.com/napi-rs/node-rs/tree/main/packages/argon2)
- Bundled Next `dist/docs/01-app/02-guides/authentication.md` and route-handler guide.
