# Existing protected Preview — Guest runtime 503 STOP

Resume authority: ae15dacaa94383dc4d4c387a50187f19945ed035, adopted after canonical
bf0d128e26149c732bc546ad0ec18d2770999228. Deployed application source remains
3fe31f26fcf555ba4a491058a6857603b6abf926; subsequent commits are documentation/evidence.

The existing authenticated Chrome for Testing context reached the exact immutable
Preview /ja/book and displayed its normal heading. No cookie, storage, session value
or unrelated tab was read. One explicit readiness GET /api/guest/draft through that
context returned HTTP503 with allowlisted error GUEST_PREVIEW_UNAVAILABLE.

Preview: dpl_3wAJbFjQ85EseBan8kp77iYQSPvF
Origin: https://zao-rental-avatar-preview-q1c57fxk3-zao-food-map.vercel.app
Provider state remains READY, canonical target Preview, Authentication ON.
Provider READY establishes deployment readiness, not functioning Guest acceptance.
Root cause is NOT_ESTABLISHED. No raw runtime logs or sensitive env values were read.
The generic response does not establish how many internal Preview DB requests ran;
no runtime DB/request-count-zero claim is made.

Under Owner's explicit "If the existing Preview itself is unusable, STOP" rule,
no further application probes or Hosted matrix execution were performed. Viewport,
real media, ratio, denial, revocation and rate-limit acceptance are NOT_RUN in this
resumed run. Existing earlier local/Neon/R2 proofs remain unchanged and are not
substitutes for Hosted browser acceptance. No Claude review was started.

Deployment attempts remain3/3; additional deployment/project/alias creation0.
Historical Production deployments2 and aliases2 remain actual counts. Current
Production deployment1 and alias1 belong exclusively to the controlled static
bootstrap dpl_FmHZxnaaBjADU7at9ezZLd9CETqL. Its exact alias is
zao-rental-avatar-preview-zao-food-map.vercel.app. Both are retained because the
latest Owner instruction allows deletion only AFTER Hosted Preview acceptance PASS.
The earlier unintended deployment and alias remain deleted. Production env0; two
sensitive env keys target Preview only. No Production application E2E, Production
DB/R2 access, Square/payment, real booking, main merge or Phase7 work was performed.

The owned Playwright browser closed successfully. No fresh Neon OAuth acquisition
was started in this resume and no operator DB pool was opened. The prior unsuccessful
OAuth wait left no task profile or file; its owned directory is empty. All four
previous runtime/role/read/write local secret files remain absent. Accepted protected
Preview, private bucket/exact3objects and its read-only runtime credential are retained.
The read credential's previously recorded TTL is unchanged; no renewal is implied.

Classification: STOPPED_EXISTING_PREVIEW_RUNTIME_503. Not Phase6 PASS.
Next gate: Owner/Technical Director assessment. No deployment budget remains;
no hidden retry, environment relaxation, cleanup-before-PASS, or review substitute.
