# R9/S2 final acceptance and cleanup

**S2_PASS**. This is one synthetic Sandbox payment, not ordinary booking or production acceptance.

| Commit purpose | SHA |
|---|---|
| Starting HEAD | 0331fb623613e5fb4dce2d0766e70d58d1b90f0b |
| Authority | a465f1e4f1469eedb54bb5f70c37405a8c9b8f17 |
| Immutable manifest + execution source | 8ec42146401a4469b55f453ff28867ba5035bbc1 |
| Evidence result (remote contents verified before cleanup) | 5feffda000c8bb2ec9bb85f8190f23a338f5d73c |
| Cleanup source | Git commit containing this document; validated per cleanup-source-hashes.json |
| Unchanged main | 3061dbbbe00294e5baebba2405028c907d6e6e85 |

Execution tree:4f103d9d35d9dc5699d1531cd1e8309d0b8e6b9e.

## Actual provider result

Runtime preflight HTTP200/PASS, zero provider calls. Guard absent before invocation,
exclusive-create/fsync reserved before one controlled same-origin empty POST.

CreatePayment HTTP200, COMPLETED100JPY. Payment ID:`pezzekG1LQRt4MVKF0X4sgRCx1FZY`.
Reference and location both match; valid updated/completed timestamp:2026-09-14T15:44:18.269Z.
Merchant authority is adopted S1 plus exact server binding, not an invented Payment field.
Operator POST1; CreatePayment1; conditional GET0; automatic retry0; manual retry0.

Fixed idempotency key:`1fc46b8b-ce24-49f6-b809-c1594c2788b5`.
Request fingerprint:`19ad7d88b5c1f0bce8e209195e1ee4c84b76e89bf6e14ac306dfc9cc2a84a9d2`.
Manifest canonical fingerprint:`8d0e345cc3f51a0293b146f5afe16673ff38c49db4dcb6ad71c50d775b2306f8`.
Local guard is retained unchanged. No repeated CreatePayment or provider lookup was used to prove green.
Counts describe this controlled R9 execution and its strict dispatch accounting; they are not a provider-wide account audit or distributed HTTP exactly-once proof.

## Preview and cleanup

Exactly one new Preview:dpl_29v9tPtTicL5GDhY9YZmy7YRDX61,
https://zao-rental-evr0jvhcj-zao-food-map.vercel.app — Ready/build success, Preview
confirmed by CLI; raw API target null is retained in evidence. Standard protection
all_except_custom_domains unchanged; custom domains0/production aliases0/Production Square env0.
Six Preview env records unchanged, key/target/type metadata only; values were not extracted.

Result was committed, pushed and remotely decoded/hash-compared first. Then both S2
routes were removed, specified checks passed, and exact S2 deployment was removed.
Read-only deployment list now contains only accepted R3:dpl_2tskZombWNMhwEKB6NG96FxkzmhL (READY).
R3, local guard, immutable manifest and the Sandbox payment are retained. No refund as cleanup.

## Validation and limitations

- Predeploy99PASS/0FAIL/0SKIP; secret scan/lint/typecheck/build exit0.
- Cleanup99PASS/0FAIL/0SKIP; secret scan/lint/typecheck/build exit0.
- Cleanup's first secret scan failed ENOENT because deleted routes remained in the Git index.
  The deletion was staged; identical checks then passed. Original exit1 evidence is retained.
- Predeploy initial lint test-name failure and corrected validation remain recorded.
- A local Vercel remove --help invocation showed usage but exited1 while its update checker
  hit a sandbox cache-write denial. Cleanup used established CI/no-update mode; no authority or permission change.
- Fixtures prove failure/idempotency guards; actual S2 was the successful fixed-source path only.
- No full business DB run, independent Claude/Spark, Web Payments SDK, webhook, real UNKNOWN recovery,
  refund, normal booking/custody mutation or production acceptance is claimed.

R9-only counts:refund0/webhook0/Production0/DB0/S1rerun0/R2/email/SMS0.
Square secret exposure0; auth callback observation/export0 in this R9 controlled path.
Historical R7 FAIL_SECURITY_BOUNDARY remains separate and unchanged.
Pattern secret scans are supplemental, not exhaustive forensic proof.

Owned browser.close completed, operator exit0; no DB/Web server/Claude/Spark started.
Validation children completed. Resource evidence:owned-resource-closure.json.

Next Owner action: explicit bounded S3 approval from
[S3 gate](../../PRODUCTION_P6_S3_GATE.md). S3 operations remain0; no new deploy or provider call is implied.
