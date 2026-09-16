# Controlled bootstrap and actual Preview

Owner amendment commit: 22806158dabe09d5ebf86577a8fce83ca563adf2.
Static source commit: 810038eaf90032fa154c62654552b50d6e06dee4.
Actual application source HEAD: 3fe31f26fcf555ba4a491058a6857603b6abf926.

Attempt2: dpl_FmHZxnaaBjADU7at9ezZLd9CETqL, Production, READY.
Only index.html (386 bytes) was submitted. Empty install/build commands, output '.',
provider function outputs0. Provider retained the project's Next.js framework label;
the `lambdas` array represents build records, with an empty function-output array.
No application code, env secret, DB/R2 connection, or application E2E was included.
Production env0; Authentication ON; custom domains0. Bootstrap remains held.

Attempt3: dpl_3wAJbFjQ85EseBan8kp77iYQSPvF, Preview, READY.
Vercel represents Preview target as null in deployment detail. Positive readback of
its exact ID in the provider `target=preview` filtered deployment list establishes
Preview classification; this is not inference from merely non-Production target.
Exact project/branch/commit and actual app build configuration matched. Two sensitive
envs target only Preview. Square/payment/refund/webhook env0. Authentication ON.
The Production filtered list contains only the static bootstrap; its alias points
at that bootstrap. The app Preview has no aliases at this checkpoint.

The attempt3 operator first stopped before guard/dispatch on directory entries in
CLI dry-run file listing. Directory handling was corrected; guard absence proved
no dispatch, then one actual create occurred. No deployment retry occurred.

Total attempt budget3/3 consumed. Historical Production deployments2 and aliases2
comprise unintended1 (deleted) and controlled static1 (temporarily retained).
Current Production deployments1 and aliases1 are the controlled static bootstrap.
Hosted acceptance and Claude remain pending; no PASS classification is claimed.
