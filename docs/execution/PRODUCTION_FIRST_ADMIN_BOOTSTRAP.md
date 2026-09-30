# First Production staff bootstrap — M3-C

PR #41 was Owner-authorized and squash-merged into main at
`b21bd2b812e202d9f29f28cfc131f3a2efdd9ce8` (tree
`ea69722ab7445080f064e2cbf6509348256df33e`, parent
`c103ed31e39b4863fc29db36f4d1e15e22d3283d`). This source branch starts there.
The bootstrap PR's merge and creation of the first Production staff account each
still require explicit Owner authority. Source validation does not grant either.
M2 remains closed; this source work does not deploy or change the accepted runtime.

## Attended command

After both remaining Owner gates, check out the exact merged main with a clean
working tree. Supply `PRODUCTION_STAFF_BOOTSTRAP_DATABASE_URL` to this one process
from the approved secure credential source, entirely in memory. It must be the
existing direct Neon `neondb_owner` credential for `neondb`, with
`sslmode=verify-full`. Do not type a credential into shell history, print it,
commit it, load a repository `.env`, or rotate credentials for this procedure.
The CLI removes this variable before starting Git subprocesses. Merely setting
the variable does not create an account; only this explicit CLI does so.

```text
npm run production:bootstrap-first-admin -- --input /absolute/owner-controlled/file.json
```

Owner supplies exactly three JSON string fields:

| Field | Required value |
| --- | --- |
| `email` | Real Owner login email; canonical account validation, maximum 254 characters |
| `displayName` | Real Owner display name, 1–80 characters, not whitespace-only |
| `password` | Owner-chosen password, 15–128 characters |

The file must be outside repositories, an absolute path to a regular file owned
by the invoking OS user, mode exactly 0600, and at most 16 KiB. Symlinks are
rejected. Do not supply account values as individual arguments, paste them into
chat or evidence, or copy the password into a profile field. The command does
not create another password file. The Owner retains control of the input file.

## Admission, transaction and evidence

The executable source must belong to the current checkout. Fresh GitHub
`origin/main` must equal local HEAD, the origin must be the canonical repository,
and the tracked/untracked working tree must be clean. The fixed Neon hostname
fingerprint is `7ad9939654fde65fa8bf8c4c043e33ca9053036d2137cf7616d365a11876c3fc`.
The actual socket must have verified TLS and the expected server name. The
actual database must be `neondb`; current user, session user and database owner
must all be `neondb_owner`. There is no expected-host override or local fallback.

One transaction takes advisory lock 7080501 and counts staff, auth users and auth
accounts. Existing staff returns `PRODUCTION_STAFF_BOOTSTRAP_ALREADY_COMPLETED`.
Orphan auth rows with no staff return
`PRODUCTION_STAFF_BOOTSTRAP_RECONCILIATION_REQUIRED`. Neither path repairs,
overwrites or reuses records. `insertAccount()` performs canonical email handling,
Argon2id hashing, account/staff/access writes and the existing audit triggers.
The account is active ADMIN / ALL, has no explicit store assignments, and has
only `PRICE_EDIT=true` as an explicit override. Existing ADMIN defaults provide
INVENTORY_VIEW, INVENTORY_EDIT and STAFF_MANAGE. The audit label identifies this
operator procedure; no technical staff row is created.

Sanitized invariant checks run before and after COMMIT: one staff/user/credential
account, expected active role/scope and permissions, valid Argon2id, no plaintext
password in written rows, one ACCOUNT_CREATED and zero sessions. Evidence
contains only these facts and the source SHA, never profile values, hash, cookie,
token or database URL. `COMMIT_UNKNOWN_READBACK_REQUIRED` and
`COMMITTED_READBACK_REQUIRED` require read-only reconciliation, never a blind
retry. Other errors are reduced to fixed codes. Development bootstrap is unchanged.

The internal transaction primitive is exercised on disposable PostgreSQL; its
tests do not weaken the CLI's host/TLS/owner admission. `test:unit` covers secure
input/release/connection rejection and output redaction; `test:auth` covers
orphan refusal, rollback, concurrency, exact overrides, development-only isolation,
and normal Better Auth login followed by real `OperationsContext.authorize()`.
These are local source proofs, not Production account/login acceptance.

## Authorized continuation after account creation

Use the existing protected Production application and Vercel authenticated
access for `POST /api/auth/sign-in/email`, holding Owner input and cookie only in
process/browser memory. Require HTTP 200, exactly one session belonging to the
new active ADMIN / ALL, and normal OperationsContext authorization for
INVENTORY_EDIT and PRICE_EDIT. Never manually insert `auth_session`.

Then resume M3-B using that session, without another catalog or price question:

- Reuse jacket model `50650295-3404-447c-93f9-70ecf1cd080c`, variant
  `38e449dd-5767-4e6f-bc78-4765916cc2b5`; pants model
  `f0feebe0-1413-48a1-b324-cf3b7359d6a9`, variant
  `b58d1ea1-522a-4b81-b922-b071b9bda236`.
- Register the full canonical Source B through `ProvisionalCapacitySourceOperations`
  and OperationsContext: SHA-256
  `c85997f464e59c616c6afb18ce03a34f6a73371d1aebeba2a6b8229bfd9c2257`,
  88 buckets / quantity 520. Reconcile and reuse the exact source if it appeared
  meanwhile. Do not directly call its SQL function under a fabricated actor.
- Initialize `ZAO_2026_27_V1` from immutable INITIAL_TABLE, PRIVATE_AVAILABLE
  revision 2, one activation, acceptance range including 2027-01-15. No price edits.
- Complete the protected normal guest flow: Adult WEAR_SET, jacket M / pants M,
  MOUNTAIN_BASE → MOUNTAIN_BASE, 2027-01-15 DAY, coupon null, wantAdvance false;
  obtain HOLD and actual Production commercial quote.
- Freeze LIVE_CHARGE_JPY and FULL_REFUND_JPY from that actual quote. Expected
  table value 5000 JPY is not acceptance evidence.

No payment/refund, email, webhook mutation, DNS, publication approval or public GO
is authorized by this source change. All Deployments protection and publication
OFF remain required.
