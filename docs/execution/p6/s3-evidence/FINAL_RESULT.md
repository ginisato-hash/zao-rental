# R10/S3 final acceptance and cleanup

**S3_NONTERMINAL_DO_NOT_RETRY**. Fixed existing synthetic Sandbox payment only.
Actual outcome details: [safe result](safe-result.json). No ordinary booking/customer mutation.

| Commit purpose | SHA |
|---|---|
| Starting HEAD | 9cae73c16e92844a824c79a74ccea100f94a4f1f |
| Formal authority | 527a5a7ba0a8725862e34db8fbb79e6468d8d934 |
| Immutable manifest + execution | bd9aea3b151896ed434f41df9b83b06c729c3f4b |
| Result remotely verified before cleanup | b68fd7b48a3187ebf173775671fc55cc16357ba2 |
| Final cleanup source | Git commit containing this document; source hashes in cleanup-source-hashes.json |
| Unchanged main | 3061dbbbe00294e5baebba2405028c907d6e6e85 |

Execution tree:1bf6537737babedeb1eba2344de62ba668392c1f.
Manifest canonical fingerprint:a010521d418619c2a9b29910eb8b9ac98c001104ddeb6bd6ffa664a06b94d83b.
Fixed refund idempotency key:98e94ea9-a081-480d-86f4-5aa491df1d6f.
Refund request fingerprint:7434acdd7be721bf57c2198e10855082febd2c992899bedca0f0a929f4746486.

## Actual result

Provider-free runtime preflight:PASS.
Operator POST:1; payment GET:1; refund POST:1; conditional refund GET:1.
HTTP results:{"payment": 200, "refund": 200, "refundLookup": 200}.
Operator response HTTP:422; this is the application classification response, separate from the provider HTTP results above.
Payment:pezzekG1LQRt4MVKF0X4sgRCx1FZY; status:COMPLETED.
Refund ID:pezzekG1LQRt4MVKF0X4sgRCx1FZY_RGsO2jleY9KU9cwHseVSYTw7u0opBFwDighGLb4MxYQ; status:PENDING.
Fixed amount100JPY. Reference match:True; payment location:True; refund location:True.
Automatic/manual retry0. No provider green-check request after completion; unknown/nonterminal never retries.
Merchant is bound via adopted S1 evidence and server metadata, not an invented Payment field.
Counts describe this controlled R10 path and dispatch accounting, not a provider-wide audit or distributed HTTP exactly-once guarantee.

## Preview and cleanup

One Preview:dpl_2K5o4MK53GBc4mz5qobLfRNswSPU,
https://zao-rental-imut3w2pk-zao-food-map.vercel.app.
Ready/build success, CLI-confirmed Preview. Raw API target null is retained in evidence.
Protection all_except_custom_domains unchanged; custom domains0/production aliases0/Production Square env0.
Only env key/target/type metadata was inspected; six Preview records remained unchanged.

Result committed/pushed/read back before deleting both temporary routes, running checks,
then deleting only the exact R10 Preview. Accepted R3 dpl_2tskZombWNMhwEKB6NG96FxkzmhL remains READY.
Immutable manifest and any consumed local guard retained. Provider objects remain; no extra refund as cleanup.

## Verification and remaining boundaries

Predeploy and cleanup:144PASS/0FAIL/0SKIP; secret scan/lint/typecheck/build exit0.
Initial typecheck failures are retained, corrected by JPY literal types and separate
S3Call type; shared P4 reason/transport/journal contracts were not widened.
Three initial authority-adoption auto-review rejections remain recorded; normal-chat
Owner adoption resolved that gate without an authority/budget reset.

Fixtures cover failure, timeout, response loss, altered payload and pending lookup rules.
Actual acceptance covers only the recorded provider result. No full business DB run,
model review, Web Payments SDK/tokenization, webhook receipt/signature/durability,
normal reservation/custody mutation or Production acceptance is claimed.

R10-only:CreatePayment0/S1rerun0/webhook0/Production0/externalDB0/booking0/inventory0/custody0/R2/email/SMS0.
Square secret exposure0 and auth callback observation/export0 in the controlled R10 path.
R7 FAIL_SECURITY_BOUNDARY remains historical. Pattern scans supplement output restrictions,
not exhaustive forensic proof. Browser closed, finite validation children completed;
no DB/Web server/Claude/Spark started. See owned-resource-closure.json.

S3_PASS alone would permit S4 gate documentation, not S4 execution.
This recorded result is not a completed-refund PASS. No S4 gate was created.
The last allowed lookup is PENDING; no eventual completion is inferred. A later
read-only lookup of the same safe refund ID requires separate bounded Owner authority.
Never send another refund POST, reset the consumed guard or use another key.
