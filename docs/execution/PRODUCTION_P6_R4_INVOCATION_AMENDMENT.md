# ZAO Rental | P6 R4 S1 authenticated invocation method amendment

Source: direct Owner instruction in the new-Mac continuation. The following records
the approved scope; it does not reset the R4 budgets or erase the Self-XSS stop.

## Owner-confirmed starting state

- GitHub is canonical: `ginisato-hash/zao-rental`.
- Branch: `codex/external-acceptance-p6`.
- Starting HEAD: `f20bff34a8f0761400ff431ae47b2bb46b376b58`.
- Phase: `BLOCKED_BROWSER_SELF_XSS_CONFIRMED_NOT_EXECUTED`.
- New-Mac local reproducibility has been verified.
- S1 `NOT_RUN`; actual POST0; actual Square requests0.
- R4 Preview allowance1/1 consumed; no new deployment allowance.
- The original maximum2 Square GET remain unspent; this is not a new budget.

## Explicitly approved replacement invocation method

The Owner supersedes the Chrome DevTools Console-paste method with one explicit
same-origin POST from a normal Playwright-managed browser context, using
`page.evaluate()` or equivalent, against the existing protected S1 Preview only:

- Deployment: `dpl_3UXKvrNyRp1KpRfpPt7jxAYSF5Bo`.
- Exact origin: `https://zao-rental-4rnscn9pc-zao-food-map.vercel.app`.
- Route: `POST /api/internal/acceptance/square-s1`.
- Header: `X-ZAO-Acceptance: SQUARE_S1_V1`.
- Body: none.
- Credentials: only the authentication state the browser normally attaches to
  the same origin; no credential extraction or replay by the operator.

If Vercel Team authentication is required, the Owner may perform ordinary login
in this Playwright browser. Request Owner action only when that login is needed.
The Codex parent owns execution; no new Claude start or additional Spark task.

## Prohibited authentication methods

Do not extract Vercel credentials, read/display/save cookies or tokens, extract
secrets from a browser profile, use a protection-bypass secret or credential in a
URL, use Vercel CLI authenticated curl, disable Chrome Self-XSS, enter
`allow pasting`, paste into DevTools Console, or turn Deployment Protection OFF.
Browser-managed ordinary same-origin authentication is explicitly approved.
The earlier `OWNER_S1_ONE_POST.js` and Console-paste handoff remain superseded
history and must not be reused or executed.

## Required ordering and durable guard

1. Save this Owner amendment in the P6 records on GitHub first.
2. Verify current remote HEAD, exact Preview ID/origin, Preview state and
   Deployment Protection. Do not create a deployment or change environment
   variables during this preflight.
3. Keep the one-shot operator local, without secrets and without permanent
   repository implementation in principle.
4. Before POST dispatch, durably commit a local one-shot guard indicating that
   this Mac has reserved/dispatched this S1. The guard must be committed before
   dispatch and must prevent a restart from invoking it again.
5. Dispatch exactly one explicit POST. Automatic retries0; manual retries0.

Timeout, browser crash, network error, response parse failure or any unknown
result requires `UNKNOWN_DO_NOT_RETRY` and a stop. Do not switch browser,
context, tab or method to obtain a green result. Never repeat this S1 after
PASS, FAIL or UNKNOWN. Budgets and historical evidence are not reset.

## Unchanged Square provider boundary

The existing [R4 authority](PRODUCTION_P6_R4_AUTHORITY.md) remains in force:

1. At most one `GET /v2/merchants/me`.
2. Only after success, at most one `GET /v2/locations`.

Origin: `https://connect.squareupsandbox.com` only.
`Square-Version: 2026-08-19`. Retry0. Production Square0; CreatePayment0;
GetPayment0; refund0; webhook0; DB0; R2 0; email/SMS0; S2 0.

## Safe result and authorized completion

Obtain only an allowlisted safe summary. Never display, persist, put into Git or
prompts any Access Token, Authorization header, Cookie, Vercel auth value, raw
secret or complete raw provider response.

Only `S1_PASS` permits registering the merchant ID as Preview non-secret
metadata, under the original R4 authority. Do not change the existing Location
ID. Do not redeploy after the environment addition.

After saving S1 evidence, clean up the temporary S1 route, run narrow tests,
secret scan, lint and typecheck, then remove only the exact S1 deployment.
Retain the accepted R3 Preview. Never proceed to S2. An UNKNOWN outcome stops
for review without any re-invocation.

## Required final report

Report the amendment-record commit, operator method, exact Preview/deployment,
POST dispatch count, Square request count, HTTP results, country/currency,
merchant/location match, CREDIT_CARD_PROCESSING, S1 PASS/FAIL/UNKNOWN,
secret exposure0, payment/refund/webhook/DB/R2/S2 0, cleanup results, final HEAD
and working tree. All this scope is Owner-approved; no unnecessary intermediate
approval wait. Pause only if the Owner must complete normal Vercel login.
