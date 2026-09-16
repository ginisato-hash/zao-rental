# Avatar Phase5 implementation checkpoint

Codex self-validation PASS; independent review NOT_RUN. Direct Owner adoption saved
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

LOW correction claims remain Codex self-validation until independent assessment:
AV-1 binding UPDATE guard with all13 protected fields tested; AV-3 new Avatar reader
isolated from the broad historical content role (the old role itself is not redesigned);
PHASE4-1 exact BOOKING_VIEW-only counterexample now denies both staff surfaces.
AV-2 remains the explicit zero-art/no-renderer/no-fake product decision, not silently closed.

253 unit/related tests,97 real local PostgreSQL checks,26 browser checks PASS; fail0/skip0
in final runs. PG includes populated0031 upgrade, fresh0032, exact PREMIUM and temp-shadow
proof. Browser covers normal guest UI, four widths,12 measured ratios, rights failure,
context/draft changes, staff permissions, unchanged group selection and existing local
fake payment/custody regressions. Not actual Safari or hosted/remote CI acceptance.
Lint/typecheck/build/secret/diff checks pass. Logs/hashes and all local test preparation
failures are retained. Seven screenshot fixtures are synthetic, never approved assets.

Approved real artwork NOT_PROVIDED. Real artwork creation/upload/hosted registration0;
customerVisible=false, publicActivation=false. Local development integration is ready;
Production adapter still fails closed. Expected PASS terminal is
PHASE5_CODE_PASS_ARTWORK_INPUT_REQUIRED, not deployed product/artwork acceptance.

Square/hosted Neon/Vercel/R2/external media/browser/Production/real customers/payments/
email/SMS/new service0. No PR/main merge. GitHub and authorized static Claude are separate
control-plane actions. All owned PG/Next/browser processes/pools are closed.
