# Public P0 validation scope and observations

Owner-authorized development scope only. PR10 exact-head merge is recorded separately;
new code remains on codex/public-ux-guest-p0 from f21b8748dba31803433e1476e143a7a1c040ee3a.
No real Square/Sandbox, public deployment, real staff/customer/stock/media, new service,
Runner or new-PR merge occurred. All people/contact/body data and photos below are synthetic.

## Counterexamples and corrections

- Owner late pickup: baseline migration0015 rejected a day2 MULTIDAY checkout with
  FLOW_CONFLICT (late-pickup-before.log). Additive0016 changes only handover time rules;
  approved0017 implements narrowly scoped no-pickup completion. Actual PostgreSQL9 cases
  passed, including day2/day3, unchanged snapshot/due/TTL, other reservation exclusion,
  Premium/wear, no prior equipment OR wear handover, exact authority and idempotency.
- The initial new blanket locale/SEO proxy truncated an existing9MiB photo's base64 JSON
  above Next's10MiB proxy clone limit. The old unchanged test expected409 PHOTO_JOB_MISMATCH
  after full body/manifest validation but received500. API routes now bypass the page proxy;
  API noindex/private-no-store headers remain in both configs, endpoint limits unchanged.
  Same9MiB/malformed/oversized expectations passed in photo-proxy-fix-2.log, together with
  all11 existing photo/content fixture cases. No general size-limit or timeout increase.
- Initial full migration recovery test expected only0001–0015. Actual new migrations
  correctly included0016–0020; two explicit expected lists were updated. Existing SQL
  migrations were not edited. Populated0007 upgrade now also asserts14 validated actor FKs
  plus preserved staff session/revision, ledger, active HOLD/claims and immutable quote.
- UI test development found an ambiguous role=alert selector: Next's route announcer was
  also matched. Assertions now identify the business main element, not an arbitrary first
  alert. Response-loss assertions wait for the operation to finish before reloading, and
  custody input/handler readiness is explicitly checked. No forced clicks, retries/skips,
  timeout inflation or API authentication bypass is used.
- One intermediate combined admin-create/rapid account-switch diagnostic returned500
  (public-ui-events.log); no secret/error payload was captured, so its cause was not proven.
  The final handoff uses distinct browser sessions for the administrator and pickup worker,
  mirroring different people, still creates the staff through the normal protected API and
  logs in with the maintained password/session library. Prior diagnostic logs are retained;
  final exact-code full staff/auth/UI regression and CI are reported separately, not inferred
  from this transient result. No claim of a reproduced account-service defect is made.

- Initial nonpersisted pageshow could complete after authentication/hydration and remount
  the staff form, clearing a typed booking QR. pageshow-before.log records the failing
  value assertion. StaffSessionBoundary now rechecks initial pageshow without hiding the
  form; actual BFCache restoration still hides it until fresh server verification. Existing
  auth/inventory regression events now explicitly use PageTransitionEvent persisted=true.
- A separate cold-route development failure was traced via browser navigation initiator:
  installed Next16.3.4 hot-reloader/app/web-socket.js line89 reloads when reconnect SYNC has
  a changed compilation hash. pageshow-initiator.log records that exact call stack during
  initial custody API compilation, not a business authorization/time failure. Public test/demo
  startup now compiles that catch-all with an anonymous GET and requires401 BEFORE any
  browser is opened. No route is mocked, no successful request retried, no HMR/safety code
  disabled. pageshow-precompiled.log then passed all5 ordinary UI/PG cases, preserving the
  same nonpersisted-pageshow assertion and authenticated late checkout. Cold-development
  HMR behavior is distinguished from a production runtime result; no actual deployment tested.

## What the evidence means

Guest cookie/context is distinct from staff. Real DB input/preview/selection has zero HOLD
until final confirmation. Whole-group advisory and final immutable quote use server prices;
changed-price acceptance,20people, wear-only and mixed Premium/wear are actual PG tests.
The normal unconnected guest HTTP path must reject simulated payment without creating stock
claims. The end-to-end test composition alone injects the deterministic payment adapter.

Public guest UI uses the normal component/API/PG path. Delivery failure is injected only
AFTER the real server response; reload reconciles saved keys once. Confirmed guest booking
is then opened by a different scoped/password-authenticated staff on day2, prepared and
checked out. Commercial conditions, due and price snapshot/hash remain identical.

Content PG and ordinary UI use normal password/session plus explicit content permission,
CSV partial commit, release revisions/outbox, synthetic image processing/private originals,
rights withdrawal, real ledger model/season/length verification and no price/stock writes.
Photo processing/release metadata are synthetic, not rights approval for real manufacturer
or owner material. New source/catalog curation and real storage operations remain unconnected.

JA/EN24 main pages and verified model SSR are inspected as initial HTML, including unique
metadata, canonical/hreflang/x-default, structured data,404/410/redirect, private/query noindex,
sitemap and image dimensions/srcset. Positive indexing is a loopback test setting only;
normal production indexing stays off. No real NAP, Offer/tax approval or real catalog coverage
is claimed. Screenshots are desktop Chromium at390px viewport, not real smartphone/CWV proof.

Historical and newly emitted performance numbers retain their own operation labels;
recommendation-preview HTTP latency is not combined HOLD+quote+payment latency.

Final local verify: 2026-09-13T06-02-40.567Z; all41 commands exit0, no skipped tests claimed.
Exact code commit/CI/review correspondence is recorded in the final PR comment and immutable manifest.
