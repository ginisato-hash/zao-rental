# Avatar Phase5 final result

**PHASE5_CODE_PASS_ARTWORK_INPUT_REQUIRED.** Codex self-validation PASS and independent
Claude static review PASS, BLOCKER0/HIGH0/MEDIUM0/LOW3. Approved artwork NOT_PROVIDED.
Implementation/evidence reviewed HEAD: `4f1aadc07cfcdb3f42f84a8cc918d714ef1ba985`,
pushed/read back clean before review. The final receipt is documentation/evidence only;
its exact commit SHA is in the final delivery report and is not labeled reviewed code.
No product/test source changed after review.

Initial review1, correction0, retry0; Claude Sonnet5 / existing Team, extra usage disabled
at organization level and isUsingOverage=false. Tools/MCP/hooks/browser0, tests executed
by reviewer=false. Review process exited0. Original result, compressed snapshot, manifest,
execution, durable one-shot guard and integrity records are under final-review/.
Snapshot SHA256: `d8079ac6525ec132ca34ac5a551bd65d7710a7c03f60de7d1d1840a1c55b1b33`.
Final receipt integrity/secret/diff checks are recorded in final-validation.json.

Direct Owner adoption saved
verbatim in AVATAR_PHASE5_AUTHORITY.md. Base4485966d87d55aa010766e5f45820541c989fa54;
branch codex/avatar-phase5-guest-integration. Phase4 history/acceptance/review is frozen.
No separate detailed Phase5 attachment was available; implementation interpretations
are explicit in PLAN.md and keep the previous external safety boundary.

GuestBooking now reuses AvatarFitPreview at the candidate step. Both appearances are
loaded by read-only GET from the owner's current draft/revision/member and saved
recommendation. Appearance is ephemeral; direction follows the existing local selection
radios. No preview/select/resume call or business POST from visual interactions.
Optional missing/failed artwork returns no renderer and never blocks ordinary booking.

Guest metadata/bytes require current context, owner, draft revision, member and offered
visual identity. Image GET rechecks those conditions around rights-checked byte IO.
Current release/immutable revision/purpose/media/digest/processed/rights/expiry/internal
conditions remain required; malformed/foreign/stale/revoked requests fail closed404.
All responses are private,no-store, with direct same-origin unoptimized image requests.
Existing public media is unchanged; no raw bytes/workspace/credentials are returned.

Additive0032 protects visual binding fields from UPDATE. Existing31 migration bytes
are unchanged. New eligible-metadata view and qualified SECURITY DEFINER derivative
function provide a narrow local Avatar reader; it cannot read workspace/raw media/
private revisions/business rows, mutate data or create permanent tables. PUBLIC cannot
execute the byte function; fixed search_path and temp shadow tests pass. Existing
content_read remains historical and is not used for Avatar queries. No authoring API.
Staff byte permissions now match the preview page: BOOKING_VIEW/HOLD_VIEW/QUOTE_VIEW.

Independent review closes AV-1 (all13 binding UPDATE fields tested) and PHASE4-1
(exact BOOKING_VIEW-only denial on both staff surfaces). AV-3 is partially addressed by
the actual narrow local Avatar reader but remains OPEN for future Production scope;
the historical general content role is unchanged. AV-2 retains the explicit zero-art/
no-renderer/no-fake decision without independent closure. New PHASE5-1 LOW records the
absence of rate limiting on local Avatar guest endpoints; add it before future non-local
exposure. All original findings and limits are in FINDING_DISPOSITION.md.

253 unit/related tests,97 real local PostgreSQL checks,26 browser checks PASS; fail0/skip0
in final runs. PG includes populated0031 upgrade, fresh0032, exact PREMIUM and temp-shadow
proof. Browser covers normal guest UI, four widths,12 measured ratios, rights failure,
context/draft changes, staff permissions, unchanged group selection and existing local
fake payment/custody regressions. Not actual Safari or hosted/remote CI acceptance.
Lint/typecheck/build/secret/diff checks pass. Logs/hashes and all local test preparation
failures are retained. Seven screenshot fixtures are synthetic, never approved assets.

Approved real artwork NOT_PROVIDED. Real artwork creation/upload/hosted registration0;
customerVisible=false, publicActivation=false. Local development integration is ready;
Production adapter still fails closed. Confirmed code PASS terminal is
PHASE5_CODE_PASS_ARTWORK_INPUT_REQUIRED, not deployed product/artwork acceptance.

Square/hosted Neon/Vercel/R2/external media/browser/Production/real customers/payments/
email/SMS/new service0. No PR/main merge. GitHub and authorized static Claude are separate
control-plane actions. All owned PG/Next/browser processes/pools are closed.
