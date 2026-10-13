# R64 local validation

> Historical first R64 candidate, superseded by the Human UI Cleanup. These counts and synthetic screenshots are not the current visual acceptance evidence. See `HUMAN_UI_CLEANUP.md`.

Authority: Issue #47, comments [6148169405](https://github.com/ginisato-hash/zao-rental/issues/47#issuecomment-6148169405) and [6149495262](https://github.com/ginisato-hash/zao-rental/issues/47#issuecomment-6149495262).

The interrupted WIP was recovered in place before edits. `TAKEOVER_RECONCILIATION.md` records the reconciliation and `SALOMON_STATION_DESIGN_PARITY.md` records the visual decisions. This is implementation evidence for independent TD review, not self-approval or publication authority.

Product/test diff SHA-256 against the accepted main: `18a64083f969210b7e3501aaea7b8de3618ef5f73e7228cf02872da073caffe9` (binary diff for `apps/web`, `config/content`, `tests`).

## Checks

Commands ran sequentially, with scratch files and mirrored logs on the external SSD. Owned successful test databases were cleaned through the existing ownership-aware test helper; unknown historical clusters were preserved.

- 46 successful command invocations across 29 distinct scripts; affected suites rerun after the final copy and responsive fixes.
- `lint`, `typecheck`, `build`, `check:secrets`, `git diff --check`: PASS.
- `check:reference`, `test:reference`: PASS.
- `test:unit`: 1,101 passed, 0 failed, 0 skipped. The four price-display tests include all 220 display cells independently calculated by the pricing engine.
- Public/guest: `test:public-ui` (includes content/model UI), `test:public-guest`, `test:readiness-ui`: PASS.
- Booking/payment/access/cancellation: `test:activation-p4`, `test:flow-ui`, `test:booking-recovery-ui`, `test:production-runtime-ui`: PASS with local synthetic/fake provider fixtures.
- Recommendation: `test:recommendations-ui`, `test:recommendation-audit`, `test:recommendation-continuation`: PASS.
- Staff/admin: `test:auth`, `test:staff-home-ui`, `test:custody-ui`, `test:wear-ui`, `test:transfers-ui`, `test:holds-ui`, `test:quotes-ui`, `test:operations-ui`, `test:operations-console-ui`, `test:m2a-launch-ui`, `test:notification-ui`, `test:content-fixture`: PASS.

`validation-receipts.json` records command timestamps, exit status and SHA-256 of each complete log. The original full receipts and logs are retained in the local/SSD evidence pack; this compact record omits machine-specific paths.

## Behavioral boundaries verified

- Menu keyboard trap, Shift+Tab, Escape, inert background, scroll lock, focus return and actual navigation remain tested. Main-link hover/focus cannot conceal secondary categories. Reduced-motion removes menu animations.
- Mobile display-heading bounds are checked on the actual text range, not just document width; 390, 768 and 1440px are covered.
- Guest flow preserves native form controls, selection acknowledgement, group review, payment states, response-loss recovery and success-state replacement. Development-only notices remain truthful in synthetic contexts.
- Recovery exchanges use the existing access flow; entered code is cleared before screenshots. Cancellation status removes the QR. No real email, Square payment or refund is dispatched.
- Custody capture reuses the existing test scenario: exact model/size verification, checkout, quantity wear, continuous return, lost response/reload, inspection, duplicate protection and permission revocation. Five checks passed without skips.
- Staff route captures use the real development app with an authenticated synthetic user; they reject permission-error headings, JSON parser errors and document overflow. The rejected legacy staff captures are not counted as final evidence.

## Scope

Backend functional delta = 0. No files changed under `packages/`, `apps/web/src/lib/`, `apps/web/src/app/api/`, `config/pricing/`, migrations, workers, workflow configuration, lockfile, environment or publication authority. Existing handlers, permissions and request bodies are retained. The reservation notice change only waits for the loaded mode before displaying development copy.

## Limits and review gate

Browser evidence uses Chromium viewport emulation at 390×844 and 1440×900, local real PostgreSQL and synthetic fixtures. It does not claim real-phone camera or live-provider acceptance. Full-page PNGs can exceed the viewport height; paired viewport images preserve the exact requested dimensions.

One remote branch / one PR / one natural Foundation CI is the handoff target. The immutable commit/tree and CI URL are recorded in the final frozen-candidate handoff after creation. Merge and production remain on hold pending independent TD review.
