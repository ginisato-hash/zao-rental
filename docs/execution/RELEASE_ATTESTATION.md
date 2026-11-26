# Production release attestation (Issue #47 P0-B)

Read-only checks that tie one release together: the freshly fetched accepted main commit, a clean tree, the PINNED Vercel team/project (constants in
`scripts/production-release-attest.ts`; the local `.vercel` link and the deployment must each equal the pin, never each other), the two Production env
values (`PRODUCTION_RELEASE_ID`, `PRODUCTION_PUBLICATION_APPROVAL`, compared in memory, never printed), the deployment (target, READY, creation time after
both writes), the formal alias, and the build digest the running deployment reports.

Artifact identity: `next.config.ts` computes a sha256 manifest over the source files being compiled (`scripts/lib/build-manifest.cjs`: apps/web/src, public,
config, packages, lockfile, package.json, vercel.json ...) INSIDE the build and inlines it; `/api/release` returns it as `buildDigest`. The operator recomputes
the same digest from the clean checkout. A deployment built from other sources cannot report the operator's digest, whatever was passed at deploy time.
The manifest includes its own calculator (`scripts/lib/build-manifest.cjs`) and `next.config.ts`. Inputs outside the listed roots (ignored/generated files, installed dependencies beyond the lockfile) are NOT covered: stated limit.
Limit, stated plainly: this proves the compiled source set, not Vercel's runtime bytes; the approval JSON is checked against a pinned approver, state, origin
and release id, but the Owner GO itself (a chat decision) cannot be verified mechanically.

Procedure (clean checkout equal to origin/main):

    # 0. record the deployment the formal alias points to NOW (the predecessor): PREV=dpl_...
    # 1. env update + stage (no domain)
    vercel deploy --prod --skip-domain --yes -e RELEASE_BUILD_SHA=<main sha>
    npm run production:attest-release -- stage <dpl_id> <PREV>   # exit 0 only on PASS; alias must STILL be exactly PREV
    # 2. two verification windows, then promote only after the stage PASS
    vercel promote <dpl_id> --yes
    npm run production:attest-release -- post <dpl_id> <PREV>    # alias must now be the candidate

The predecessor id is an argument of BOTH modes: stage requires the alias to equal it, post requires the alias to be the candidate and the candidate to differ from it (PREVIOUS_ALIAS_INVALID otherwise).
Never promote after a stage FAIL. Reason codes: SOURCE_NOT_ACCEPTED_MAIN, WORKTREE_DIRTY, PROJECT_LINK_MISMATCH, RELEASE_ID_MISMATCH, APPROVAL_MISMATCH,
DEPLOYMENT_WRONG_PROJECT, DEPLOYMENT_NOT_PRODUCTION, DEPLOYMENT_NOT_READY, RELEASE_ID_NOT_BEFORE_DEPLOYMENT, APPROVAL_NOT_BEFORE_DEPLOYMENT,
STAGE_ALIAS_NOT_RECORDED_PREVIOUS (stage), PREVIOUS_ALIAS_INVALID, ALIAS_NOT_THIS_DEPLOYMENT (post), RUNTIME_SHA_MISMATCH, BUILD_DIGEST_MISMATCH, DEPLOYMENT_EVIDENCE_MISSING.
Releases before this procedure (PR #78-#82) have no runtime digest and stay UNVERIFIED for that part; nothing is reconstructed.
