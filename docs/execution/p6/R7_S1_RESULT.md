# P6 R7 S1 result — provider PASS; acceptance security condition failed

The exact API version correction succeeded. The single S1 invocation returned
structured **S1_PASS / HTTP200**, with two successful Sandbox identity GETs.
However, **R7 acceptance is FAIL_SECURITY_BOUNDARY**, because transient Vercel/
Google authentication callback information appeared in tool output during Owner
login. The required overall `secret exposure = 0` cannot be asserted. This is
an operator observation/output failure, not a Square identity or API-version
failure. No callback values are reproduced in this evidence.

## Exact execution

- Starting HEAD: `69a2716eda1953fcd147b90f135e4fdd963ef974`.
- Authority commit: `f4c6dc7c27d11bc4db635ba6eef1bab0686db431`, pushed/read back first.
- Execution source: `f9468c81144ba6c1db3bade87c6e72d55b8c07a8`.
- Source tree: `39b9f85c972cdc01e64c3a4d72ac6f4aa2243025`.
- Deployment: `dpl_J8Dpxh5mogQR4Mo6xvqNUDMSwv8m`.
- Origin: `https://zao-rental-p7g3j78c0-zao-food-map.vercel.app`.
- Preview, Ready, successful build; Require Log In / Standard Protection enabled.
  Custom domains0, aliases0, Production Square env entries0. Preview allowance1/1.
- One normal Vercel UI Edit/Save changed only Preview `SQUARE_API_VERSION` to
  the known literal `2026-08-19`, retaining Sensitive/Secret. No previous value
  or readback value was displayed; metadata-only verification succeeded.
  Other env mutations0; existing R3 unaffected.
- Local-only Playwright operator, normal Owner login, same authenticated browser
  context and exact same-origin request. No cookie/token/storage export, bypass,
  Console paste or auth-header extraction. Subsequent status observations omit
  page titles and auth URLs; the one earlier incidental output remains disclosed.

## Runtime preflight

HTTP200 at `2026-09-14T13:04:10.039Z`; provider requests0 for preflight.

| Flag | Value |
| --- | --- |
| environment / deployment | SANDBOX / preview |
| apiVersionMatch | true |
| applicationIdConfigured | true |
| locationIdConfigured | true |
| accessTokenConfigured | true |
| accessTokenFormatValid | true |
| publicCredentialExposure | false |
| readyForS1 | true |
| result / reason | PASS / null |

`publicCredentialExposure=false` describes the deployed public-environment
check; it does not erase the separate operator authentication-output incident.

## One S1 invocation

The R7 guard was fsynced at `2026-09-14T13:04:17.824Z`, before observed POST
 dispatch at `2026-09-14T13:04:17.832Z`. Result at `2026-09-14T13:04:18.663Z`.
The immutable reservation intentionally remains closed against any retry.

| Result field | Observed |
| --- | --- |
| explicit POST / retry | 1 / 0 |
| merchant GET / locations GET / total | 1 / 1 / 2 |
| S1 HTTP / merchant HTTP / locations HTTP | 200 / 200 / 200 |
| Square host / version | connect.squareupsandbox.com / 2026-08-19 |
| stage / reason | LOCATION / null |
| merchant ID | MLKDVEDH1ME21 |
| merchant status / country / currency | ACTIVE / JP / JPY |
| locations returned | 1 |
| configured location found exactly once | true |
| location status / country / currency | ACTIVE / JP / JPY |
| merchant.main_location_id = configured location | true |
| location.merchant_id = merchant.id | true |
| CREDIT_CARD_PROCESSING | true |
| structured service result | S1_PASS |
| R7 acceptance decision | FAIL_SECURITY_BOUNDARY |

The exact configured location identity was verified server-side through match
flags. Its secret-typed env value was not read or exported. Both counted fetch
calls obtained HTTP200; no extra provider request or forensic lookup was made.

## Security and conditional actions

Square access token/raw provider response exposure0; cookie/token extraction0;
secret values committed to Git0. **Overall secret exposure is not zero**: one
ordinary-login incident included transient authentication callback information
in tool output. No assurance about retrospective removal from tool history is
claimed. Evidence intentionally records only the incident type and mitigation.

Because R7's zero-exposure acceptance condition failed, merchant metadata
registration and `PRODUCTION_P6_S2_GATE.md` creation are **not performed**.
No S1 retry, alternate browser/context/method, second Preview or S2 execution.

Production deploy/Square, real customer/card, CreatePayment/GetPayment/refund,
webhook creation/delivery, external DB/R2/email/SMS/S2, main merge, Runner,
ruleset/billing/permission changes, Claude/Spark/new PR: all0.

## Validation, cleanup and next gate

Predeployment: Node24.15.0/npm11.12.1, **69 tests pass**, fail0/skip0;
secret scan/lint/typecheck/build all pass. Only the two R6 temporary routes were
restored; reusable pure logic/service/transport/tests are unchanged.

Result and evidence are saved to GitHub before cleanup. Route deletion,
post-cleanup validation and exact deployment removal are recorded in a following
cleanup commit. Accepted R3 and historical R4/R6 records/guards are retained.

The next Owner action is one decision: review the authentication-output incident
and decide whether the already-recorded identity evidence can be accepted under
separate authorization for merchant metadata and S2-gate preparation. The R7
S1 is terminal and must not be repeated. S2 itself is not authorized.
