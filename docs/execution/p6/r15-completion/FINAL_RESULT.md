# R15 Completion — execution checkpoint for final independent review

Implementation/external acceptance: **SELF_VERIFIED PASS**. Cleanup: **PASS**.
Independent final review: **PASS**, used1/1, retries0.
R15 terminal classification: **R15_PASS**.
No further live invocation, deployment, payment/refund, Claude retry, main merge or
Production GO. Next: **ChatGPT Technical Director terminal cross-system assessment**.
The preserved [review](final-review/review.json) is the independent verdict; self-tests
are not substituted for it. Severity counts: `{"BLOCKER": 0, "HIGH": 0, "MEDIUM": 0, "LOW": 2}`.

## Binding and history

- Owner authority: [canonical text](../../PRODUCTION_P6_R15_COMPLETION_AUTHORITY.md),
  SHA-256 `a71b71e976cb7be4942837e4e4c0ae07e295fcfb78353a72770dbc2a446ba4f0`,
  recording commit `6284dbf3c1a449b56bd565482e432d2a9b1422b2`.
- Starting HEAD `6145a03c76d42967239c21841e5917543fb61b95` reconciled the requested
  `2544261efafdc98741dd55cab278b859bc4c7f2b` with its authorized GitHub descendants.
- Branch `codex/external-acceptance-p6`; main remains
  `3061dbbbe00294e5baebba2405028c907d6e6e85`; no new PR or merge.
- R7 incident, R10 nonterminal refund, R14 PARTIAL, initial/correction reviews,
  original F3 HIGH, historical 42501 and credential handoff failures remain unchanged.
  F3 dedicated review retired unused. Final review alone may assess the new F3 proof.
- Frozen reviewed code/evidence HEAD: `ba90acf0b1bff9f937474ff85cf033d12a9c70a3`.
  Snapshot SHA-256: `2b6abf6348cec9cb95d9c6aaae4ef39aaa7f4439f2e74b9a2a0ec43aa16fb1df`.
  This terminal receipt commit changes documentation/evidence only, not reviewed code/tests.
  The file manifest and compressed sanitized static input are retained under final-review/.

## Hosted infrastructure

Existing Free Neon `store_i5vh0ZEKo2ikcVo9`, DB `zr_852b20c4d4b0` reused.
New resource0, hosted DB0, recreation0, paid upgrade0. Canonical migrations0001–0030
PASS with30 exact checksums. Historical failed invocation1 remains; this authority
used one successful logical migration run. Positive role checks6, negatives46 and
0030 durable guard checks12 PASS on hosted Neon, including CREATE_PAYMENT semantics.
Setup owner plus five runtime roles were tested; a sixth app-like role proves PUBLIC denial.

The rollback-only diagnostic isolated42501 at migration0015 ALTER (object transfer
requires the administrative creator to SET ROLE). Public CREATE already passed,
so public-CREATE grant0. Transaction-local creator inheritance/SET and temporary
CREATE for the newly created NOLOGIN custody_executor permit the unchanged migrations;
effective SET/INHERIT and CREATE are removed after0017. No SUPERUSER/provider system
role/PUBLIC expansion or ownership takeover. PostgreSQL creator ADMIN-only membership
remains, with SET=false/INHERIT=false; it is not misreported as absent.
See [compatibility](SETUP_COMPATIBILITY.md), migration/role/guard JSON evidence.

## Ingress, subscription and signed delivery

Additional dedicated deployments2/2 READY, then deleted:
`dpl_4PSnSR7i36FX2KYvGTxtvvDUnUJ4` (bootstrap) and
`dpl_2NcfhWfbzMrMiXLMm9HF7orj4mTQ` (signed).
The earlier failed/deleted deployment remains historical. Stable notification URL:
`https://zao-rental-webhook-sandbox.vercel.app/api/webhooks/square`.
Bootstrap health200 / missing-key POST503; final health200 / unsigned403 / bad-signature403,
failed-signature DB writes0. Dedicated receiver has no Square access token or setup credential.

Protected main Preview1/1, `dpl_AVUzH2qBPkmr3V15YefkogYvWKdM`, origin
`https://zao-rental-onu3i3rit-zao-food-map.vercel.app`, READY then deleted.
Deployment Protection retained; customer routes0. Operator source
`023d819ef0ed5b427a2d80a34c68825ca6002f64` (see preview build manifest).
Subscription CREATE1 HTTP200, safe ID `wbhk_3a75e3b3e2cc4fe4a7406807114a5ce5`;
Sandbox events payment.created/payment.updated, API version2026-08-19.
Non-disclosing signature handoff used existing browser/Node RAM and Sensitive env pipe.

Official test1: the operator returned503/UNKNOWN and was never retried. Read-only
reconciliation proved its signed durable inbox receipt, and Vercel request metadata
proved ingress POST200. **Receiver proof PASS; test control-response remains UNKNOWN.**
No raw provider body, signature, cookies or credentials were retained as evidence.
See [signed proof](signed-webhook-proof.json) and original/reconciled official-test evidence.

## One synthetic payment → provider truth → business projection

Actual manifest committed/pushed/read back at
`95344423a08c7ac2150ed7da75966d313078c4e0` before payment. Actual file SHA-256
`ac2f8e03dc0398d6e875d14e30903a84de66bdfcb01a73cde86f2d2576ec2de9`
was verified from bytes and installed identically in the hosted guard.
One complete synthetic100JPY quote/HOLD/booking/attempt fixture uses merchant
`MLKDVEDH1ME21`, existing location `LYCHY1VT97DQ3`, JP/JPY.
The prior DB_ONLY test reservation was removed only by its exact test hash before live
manifest installation; no live reservation/budget was reset.

CreatePayment1, durable CREATE_PAYMENT reservation COMMIT before provider dispatch,
HTTP200 / COMPLETED, safe payment ID `hAiVuN7sPLZeZkEy6PFjQ5pCS5SZY`.
Retry0, alternate idempotency0. Natural signed receipts2. Targeted GetPayment1 HTTP200
verified merchant/location/100JPY/status and exact attempt binding. Webhook was not
business truth. R12 ACCEPT_COMPLETED; R13 APPLY_COMPLETED; projection event1/revision1.
Booking CONFIRMED_DEV, attempt COMPLETED, HOLD payment SUCCESS. Explicit duplicate
projection replay returned duplicate=true, no second event. Notifications0.
See [payment](payment-result.json), [E2E](e2e-result.json), [DB readback](e2e-db-readback.json).

## Cleanup and limits

Subscription DELETE1 returned Square HTTP200. The deployed operator expected204 and
initially classified UNKNOWN. Reading that same cached browser response (new requests0)
confirmed HTTP200 without resending. Original UNKNOWN evidence remains alongside its
readback. The final source corrects HTTP200 empty/no-error JSON classification and adds
three regression tests; this correction was locally tested, never redeployed or retried.

All3 new acceptance deployments deleted; added env10 deleted and read back absent.
Accepted R3 `dpl_2tskZombWNMhwEKB6NG96FxkzmhL` retained READY. Projects and existing Neon
DB retained; only minimal synthetic proof/audit/payment data remains. Initial test
credentials6 invalidated; fresh runtime credentials5 and PUBLIC probe disabled.
Temporary `~/.secrets/zao-rental-r15.pguri` deleted; all pools/browser/operator closed,
operator exit0. See runtime-cleanup.json, vercel-cleanup.json and subscription-cleanup-readback.json.

Square requests5 total: subscription create1, official test1, CreatePayment1,
GetPayment1, subscription delete1. Automatic/manual retry0. Production Square0,
real customer/card/booking/inventory/custody0, refund/GetRefund0, R2/email/SMS0,
main Production deployment0, main merge0. Secret exposure observed0; pattern scans
and safe evidence support this claim but are not mathematical proof of all external systems.

## Validation and final independent disposition

Local real PostgreSQL + stub provider E2E PASS, not substituted for hosted proof.
Final source targeted tests26, lint, typecheck, secret scan and local operator bundle
build are recorded in final-validation.json. No remote CI pass is claimed for this HEAD.
The final reviewer closed current F3 and NEW1 against the new implementation/hosted
evidence; their original HIGH/LOW history remains. Open LOWs are R15F1 (corrected
DELETE classification not live-reverified / authoritative citation absent from input)
and R15F2/F4 (root install dependency surface). No new live check is authorized.
Ingress is cleaned up, not accepted as a long-lived service.

Final review findings/dispositions are preserved verbatim in final-review/review.json.
Original F3 HIGH, NEW1 LOW and F4 LOW historical records are not rewritten. The final
review may assess their present disposition; its exact result governs this checkpoint.
No remote CI result or independent test execution is claimed.
