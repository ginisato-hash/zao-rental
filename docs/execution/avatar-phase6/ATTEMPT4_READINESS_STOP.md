# Corrective Preview attempt4 — PREVIEW_IDENTITY 503 STOP

Authority commit: 58152d871c5b869f24f2dcdbaae2a23988952b1f.
Corrected/deployed source: 0122451a4d2e2910bb3219912df922babd5a2cdb.

The correction accepts only an absent VERCEL_GIT_COMMIT_REF. Every present ref,
including an empty string, must equal the exact Phase6 branch. Required platform,
Preview target, exact project, immutable URL and forbidden-env boundaries remain.
Startup errors now retain only a fixed stage; HTTP serialization excludes raw error,
cause, stack, credentials, connection strings, env values and certificate data.
All630 unit tests, lint, typecheck, build, secret pattern scan and diff check PASS.
The full-suite stale migration tests were reconciled to existing0031/32 without
changing any migration SQL or the frozen R15 verifier; historical byte hashes PASS.

Attempt4 was dispatched exactly once, after a durable exclusive guard and validation.
Deployment: dpl_2HAREDuFGBcRNXyKNbiaU4qkMuZZ
Origin: https://zao-rental-avatar-preview-dkbmsa00j-zao-food-map.vercel.app
Provider READY, positive exact-ID membership in target=preview filtered listing,
exact source/branch/project, Authentication ON, exactly2 sensitive Preview-only envs.
No Square/payment/refund/webhook env keys or Production env. No new project/alias
creation request was made. Total deployment attempts4/4 consumed; no attempt5 authority.

A new task-owned browser used static robots.txt for normal Vercel authentication.
Owner completed login and authenticated text/plain response confirmed the gate.
No browser credential/state extraction or unrelated tab inventory was used.
Only then a separate fsynced readiness guard reserved one GET /api/guest/draft.
The single request returned HTTP503 / GUEST_PREVIEW_UNAVAILABLE / PREVIEW_IDENTITY.
Retry0. Raw response not saved; only allowlisted status/category fields retained.

This establishes failure in previewOrigin's identity/configuration boundary, before
CONFIG_PARSE and DB connection stages. It does NOT establish which required field
is missing/mismatched, nor prove the earlier503 was caused by absent Git ref.
No further app probes, raw logs, env-value inspection or boundary relaxation followed.
Authority section8 requires STOP after repeated503; Hosted E2E matrix and Claude
review are NOT_RUN. No ordinary or contained-deviation Phase6 PASS is claimed.

Historical Production deployments2 and aliases2 remain actual. Current Production
1/1 is exclusively the authorized static bootstrap:
dpl_FmHZxnaaBjADU7at9ezZLd9CETqL, alias
zao-rental-avatar-preview-zao-food-map.vercel.app.
Owner requires Hosted acceptance PASS before its deletion, so both remain retained.
Production env0. Previous unintended deployment/alias remain deleted.

The owned browser and operator exited successfully. No new Neon OAuth session or
operator DB connection was created; the previous temporary OAuth directory is empty
and all prior local runtime/role/R2 credential files remain absent. Protected Previews,
private R2 bucket/exact3objects and the existing expiring read-only runtime credential
remain retained. No secret renewal, R2 mutation, Square/payment, real booking,
Production application E2E/DB/R2 access, main merge or Phase7 was performed.
Historical metadata incidents and prior readiness503 remain unchanged.

Classification: STOPPED_CORRECTIVE_PREVIEW_READINESS_503_PREVIEW_IDENTITY.
Next gate: Owner/Technical Director assessment with no further deployment budget.
