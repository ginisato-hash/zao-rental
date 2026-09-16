# Unexpected Vercel Production target — contained, not PASS

Classification: STOPPED_UNEXPECTED_VERCEL_PRODUCTION_TARGET_CONTAINED.
This is a deployment-scope violation, not a newly observed credential exposure.
No Phase6 PASS, accepted Preview, Hosted GuestBooking E2E or final Claude review.

## Completed authorized configuration

The Owner's exact secret-transmission authority was committed and remotely read
back at 28d388620a6dd7e1f6b1310553c7fd25a76316cb. Both keys were created as
sensitive, target=[preview], on zao-rental-avatar-preview only:
ZAO_AVATAR_PHASE6 and ZAO_HOSTED_PREVIEW_RUNTIME. Metadata evidence is in
vercel-settings.json; no values were displayed, logged or saved as evidence.
Square/payment/refund/webhook/Production env counts are zero.

The branch-specific requests were rejected without Git integration. The corrected
Preview batch request returned INVALID_BODY; zero entries were read back before
the successful single-entry requests. These failures are retained, not reset.

## Actual deployment outcome

- Exact project: prj_EonVxKra8p9txdZ7O2Ko6t1A8biW / zao-rental-avatar-preview.
- Deployed source HEAD: 33e054594ad281d2acc5335e4e5284c81c56bbff, matching remote,
  clean tree and codex/avatar-phase6-hosted-preview branch before dispatch.
- CLI59.9.1 command explicitly passed --target preview, --project exact ID,
  --scope zao-food-map, --yes, --json and --no-wait; --prod was never passed.
- One fsynced dispatch guard was reserved before the one deployment invocation.
- Returned deployment: dpl_AFGcBTc3zZJSNngvrRoBTygJmeCj.
- Returned immutable origin:
  https://zao-rental-avatar-preview-g4toqeqxh-zao-food-map.vercel.app.
- Returned and independently read-back target: production.
- Vercel also assigned zao-rental-avatar-preview-zao-food-map.vercel.app.
- Actual unintended Production deployment count1 and Production alias count1.
  Deletion does not make those historical counts zero.
- Actual Preview deployments0; the first of the total2 allowed deployment attempts
  is conservatively consumed. Remaining1 is unused. There was no second deployment.

The target mismatch was detected immediately in the captured CLI result. Hosted
browser acceptance and Claude were not started. The deployment was BUILDING on
the first containment read, and reached READY before successful deletion.
We did not navigate to or test this unintended Production deployment.

## Root-cause evidence and agent verification gap

The installed official CLI's top-level parseTarget preserves the string preview.
However, the bundled deployment SDK in chunk-OHQJEOP7.js, lines46813–46815,
changes deploymentOptions.target from preview to undefined before the API POST:

```js
if (deploymentOptions.target === "preview") {
  deploymentOptions.target = void 0;
}
```

The bundled CLI also contains an explicit message describing implicit Production
assignment for a project's first deployment when no target reaches the request.
The observed provider result is consistent with that path. Provider server internals
were not inspected. The parent preflight checked the top-level parser but missed
the later SDK normalization; this was an agent verification gap. The invocation
method is retired locally and refuses any further dispatch.

Official references inspected read-only after containment:
https://vercel.com/docs/cli/deploy and
https://vercel.com/docs/rest-api/deployments/create-a-new-deployment.
Documentation alone is insufficient to claim the existing CLI path forces a
first deployment to Preview. No speculative API/CLI retry was used to consume
the last remaining slot or risk another Production assignment.

## Containment and final retained state

1. The first DELETE calls did not dispatch because the CLI requires interactive
   DELETE confirmation. They were not provider authorization failures.
2. The standard interactive confirmation was answered for the exact owned
   deployment, with response output suppressed. No bypass flag was used.
3. The deployment then returned404 and the project's Production target was null.
4. A dangling alias still pointed at that deleted ID. Name-based DELETE returned404;
   the read-back exact alias UID was then deleted with standard confirmation.
5. Final read-back confirms both deployment404 and alias404, no Production target,
   Authentication still ON, and both env entries still sensitive/Preview-only.

See deployment-1.json, deployment-1-containment.json,
deployment-1-containment-followup.json, deployment-1-cleanup.json and
deployment-1-cleanup-final.json. Intermediate cleanup failures remain recorded.

The task's Neon OAuth profile was revoked and removed through the official CLI;
revocation and removal were reported, exit0, no warning. Three local temporary
secret files were deleted. The earlier R2 write key was already revoked/deleted.
No browser, local handoff server or DB pool was opened in this continuation.

Retained: dedicated protected project, two Preview-only sensitive env entries,
six least-privilege runtime roles, private R2 bucket and exact3 approved objects,
existing read-only R2 credential until its expiry. No credential rotation or new
credential, DB/resource, bucket or object was created in this continuation.

Existing zao-rental project changes0; custom domain0; Square/payment/refund/webhook0;
main merge0; Phase7 operations0. New task-secret exposure observed0, with both
historical metadata incident records preserved byte-identically. This is not a
claim that all historical tool metadata had zero exposure.

## Next gate

Owner assessment of the contained Production boundary deviation is required before
claiming a revised successful outcome. The existing Production0 success condition
is now factually unmet. A continuation must preserve the actual1/1 historical
deployment/alias counts and the consumed deployment slot. Before any remaining
Preview invocation, establish and review a first-deployment path whose transmitted
request and provider contract enforce Preview, without production/bootstrap steps,
new projects, Git auto-deploy, paid/custom environments or protection bypass.
There is no new request for approval of the already-authorized secret transmission.
No Phase7 or main integration is authorized by this record.
