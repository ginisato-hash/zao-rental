# R4 Square Sandbox S1 boundary

Owner authority: PRODUCTION_P6_R4_AUTHORITY.md (original retained). No business/payment state-machine, dependency or runtime-version change.

## Implementation and limits

The existing bounded Square JSON reader is shared by a dedicated S1 transport. Its complete allowlist is Sandbox GET `/v2/merchants/me` and `/v2/locations`, version2026-08-19. Payment transport keeps its existing capability and credential binding; S1 cannot create/query payments/refunds or call arbitrary paths. Server-only credential reference, redirect:error, no ambient credentials, byte ceiling1MiB, abort deadline5s per request, no retry. Non-2xx/raw provider errors never export bodies. The service validates ACTIVE/JP/JPY, configured main location and merchant/location binding before PASS; card capability absent is WARNING and does not permit further calls. Observed HTTP status survives malformed JSON, without raw body export.

Temporary Preview-only POST composition is not linked from UI/sitemap/docs. Browser navigation/prefetch cannot execute it. It requires Preview, SANDBOX, exact version and non-secret intent; the intent is not authorization. Actual deployment must remain behind independently checked Vercel Team protection. Only an empty POST is accepted, including Next's empty Node request stream. No cookie/env/token logging or payment/DB composition. Unexpected token reflection in a response field fails closed.

The in-process latch prevents concurrent/repeated calls within one isolate, **not** across all serverless instances. Global budget is enforced operationally by the single explicit operator dispatch journal, no retries on response loss, and deleting the S1 deployment after evidence. It is a temporary supervised acceptance route, not an unattended or durable operation endpoint. Do not leave it as a permanent product API or merge it into main.

## Validation

47 tests PASS /0fail/0skip:15 S1 cases plus existing Square transport/state/preflight fixtures. Secret scan, lint, typecheck and Next build exit0. Fixtures only; actual Square0 at this predeployment checkpoint. No DB/Square/R2/email/SMS. No full business verify or new Claude review is represented.

Spark task P6-SPARK-SQUARE-S1-TEST-01 edited only tests/readiness/square-s1.test.ts. Initial8 passed; one requested correction produced13pass/1fail. That failing test injected a different secret into transport and invoked the pure service instead of the acceptance redaction boundary. Parent corrected the fixture to inject the actual synthetic token into the acceptance handler, added the Next empty-stream/concurrency regression, and verified all15 S1 cases. Parent owns all production code/transport/infra decisions. No further Spark or Claude started.

## Authenticated dispatch constraint

Installed Vercel CLI59.9.1 `curl` automatically obtains/creates a protection-bypass token and passes it to a spawned curl command as a header argument. That conflicts with R4's no-secret-CLI-arguments condition, so it is not used. No protection change, bypass secret, secret extraction or credential cloning is authorized by choosing an alternate client. Use an ordinary authenticated Team browser explicit POST, with no retry/preload; do not navigate to execute the endpoint. If the available UI tools cannot issue that request without extracting credentials, the remaining boundary is one Owner browser operation, not permission to weaken protection.

No actual endpoint URL is published in this document. Actual invocation instructions, if needed, belong in the local Owner handoff only. Before any call, verify exact deployment/source/protection, record dispatch intent, and maintain maximum2 Square GET. Unknown results consume the possible budget; never retry green checks.

## Official contracts consulted

- [Retrieve merchant](https://developer.squareup.com/reference/square/merchants-api/retrieve-merchant): `me` resolves the currently accessible merchant.
- [List locations](https://developer.squareup.com/reference/square/locations-api/list-locations): validate the configured record rather than trusting array order; other records may be inactive.
- [Vercel curl](https://vercel.com/docs/cli/curl): documented automatic protection-bypass header; installed source confirms subprocess argument handling.

S1_PASS alone permits adding verified merchant identity as Preview metadata, without redeploy. WARNING/FAIL/unknown never causes configuration replacement or another call. Stop before S2, Web Payments, payment/refund/webhook/DB activation. Accepted R3 Preview remains retained.
