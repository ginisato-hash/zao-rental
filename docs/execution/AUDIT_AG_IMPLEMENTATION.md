# A–G implementation record

Current authority: [owner delegation](AUDIT_AG_DELEGATION.md), immutable receipt
https://github.com/ginisato-hash/zao-rental/pull/9#issuecomment-5645441833.
Run01 starts2026-09-12T10:37:21Z, deadline18:37:21Z (JST19:37:21 to03:37:21 next day).
Historical review starts4; new shared budget8, none started at A/B/F implementation checkpoint.
No merge permission. E09_CONTINUATION remains the resolved time contract.

## A: target settings compare-and-set

Ordinary staff edit sends expectedRevision. Schema rejects missing/invalid values;
server compares the actual target revision under row lock before any field mutation.
Name/access/role/active writes and audit commit together. The returned revision is
read from DB after triggers; clients never guess +1. Display-name-only writes now
increment revision via additive0008. Login/failure/password timestamps do not.
409 preserves the user's stale form but disables submission until explicit reload;
no automatic revision replacement or resubmission. Two administrators are tested in
both orders for disable, role, permission and store removal, then explicit reload/save.
Acting-admin revocation is independently checked at the settings boundary.

## B: cancellation/write order with separated DB roles

Normal runtime binds the server-verified session ID and staff ID; browser role/store
or stamp are not identity. Initial forbidden-scope checks precede inventory waiting.
After inventory and target row locks, the ledger transaction acquires a shared
per-staff advisory71820901/hashtext key. A separate auth connection checks live
session, active staff, current view/edit permissions and actual store/global scope.
That read connection is released immediately. The shared key remains on the ledger
transaction through COMMIT/ROLLBACK, even if the auth connection fails. Settings
writers acquire exclusive sorted actor/target keys; existing staff/store/permission
revision triggers join this ordering through additive0008. A committed cancellation
therefore precedes refusal, or an already admitted write commits before cancellation.
This is an ordered protocol across two connections, not a single DB transaction.
Long inventory waits hold no staff key/auth connection. Existing short SQL/lock
timeouts bound failure; no new DB privileges or security-definer function was added.
Ledger still cannot SELECT staff tables; auth cannot UPDATE ledger; audit stays append-only.

Real-DB synchronization tests cover permission/store/disable cancellation during
update and create waits, target-row waits, reverse order at the final commit gate,
forbidden-store early refusal, correct actor audit and no idle-in-transaction residue.
This guarantee concerns active/role/permission/store settings, not a new universal
logout/credential change serializability contract. A live session is rechecked after waiting.

## F: finite HTTP request contract

Schema remains20people ×3components ×6candidate UUIDs. Maximal ordinary JSON
conditions/wrapped create/amend/quote measure18865/18932/18974/19058UTF8bytes.
Server-selected24576byte cap applies only to HOLD create/amend/availability and
quote create. Default16384 remains for auth, small ledger and other operations.
Actual stream chunks are counted, independent of Content-Length; overflow cancels
the reader and returns413. Invalid UTF8/JSON422; existing auth wrapper keeps its
sanitized400 for oversized auth input. Anonymous/CSRF refusal precedes parsing.
Whitespace padding is not an unbounded supported schema payload.

The ordinary password-authenticated direct API test sends18267bytes with actual
synthetic stock, creates20person/60component HOLD and a matching persisted quote,
amends/replays without duplicate claim/TTL extension. HTTP acceptance and stock
feasibility are separate assertions. E09 still expands choices internally without
passing that expansion through HTTP; this does not evade solver limitations in E.

Evidence: [manifest](evidence/audit-ag/abf/manifest.json). Initial meaningful baseline
failed all10 counterexamples; final23 normal-path checks,2body units and populated
0007→0008 migration passed. Ordinary UI uses synthetic individual password sessions,
not test principals. Migration preserves accounts/session, ledger, active group HOLD,
claims and immutable quote; simultaneous migrators and unchanged DB grants verified.
Independent review and whole A–G integration are pending at this checkpoint.

A/B/F integration checkpoint: full `npm run verify` passed at local evidence2026-09-12T11-09-49.855Z. All commands exit0, no skipped cases. Migration count expectations were updated to the registered plan; no applied migration content changed.
