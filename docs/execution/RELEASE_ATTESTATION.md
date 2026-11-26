# Production release attestation (Issue #47 P0-B)

Facts this procedure ties together for one release: accepted main commit, clean tree, linked Vercel project, the two Production env values
(`PRODUCTION_RELEASE_ID`, `PRODUCTION_PUBLICATION_APPROVAL`), the deployment (project, target, READY, creation time), the formal alias and the
build id the running deployment reports. Values are compared in memory only; the report has fixed reason codes, ids and times.

Deploy (from a clean checkout equal to origin/main; after the two `vercel env add ... --force` updates):

    vercel deploy --prod --skip-domain --yes -e RELEASE_BUILD_SHA=<main sha>

`-e` is per deployment and immutable, so `/api/release` of that deployment reports the commit it was staged for. Then, before AND after promote:

    npm run production:attest-release -- <dpl_id>      # exit 0 only on PASS; read-only

Reason codes (any one = FAIL): SOURCE_NOT_ACCEPTED_MAIN, WORKTREE_DIRTY, PROJECT_LINK_MISMATCH, RELEASE_ID_MISMATCH, APPROVAL_MISMATCH,
DEPLOYMENT_WRONG_PROJECT, DEPLOYMENT_NOT_PRODUCTION, DEPLOYMENT_NOT_READY, RELEASE_ID_NOT_BEFORE_DEPLOYMENT, APPROVAL_NOT_BEFORE_DEPLOYMENT,
ALIAS_NOT_THIS_DEPLOYMENT (expected before promote), RUNTIME_SHA_MISMATCH, DEPLOYMENT_EVIDENCE_MISSING.

Limits stated plainly: the two env values are read from the project's current configuration (not a per-deployment snapshot); the attestation
requires both to have been written before the deployment was created and never changed after it matters only through that ordering check.
Releases before this procedure (PR #78-#81) have no runtime build id and stay UNVERIFIED for that part; nothing is reconstructed.
