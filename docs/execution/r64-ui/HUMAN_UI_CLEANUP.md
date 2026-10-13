# R64 Human UI Cleanup

Owner authority: Issue #47 comments 6150862154 and 6151192237, plus the directly supplied correction. Continue in the recovered f2 worktree on `codex/r64-salomon-station-ui`; pre-cleanup checkpoint `b5903a1071050ea3eea5ea174b0ea124c2d8da50`.

## Result and review boundary

The Salomon Station typography, colours, imagery and navigation remain. Customer copy describes booking actions. Staff copy describes operational actions. Internal IDs and status enums remain available in closed technical disclosures. This is a local implementation candidate; independent TD visual acceptance and publication remain on hold.

R64 changes no business contracts, server routes, core services, pricing, database schema or provider composition. R65 starts only after this cleanup's local checkpoint. Owner's later DIN instruction belongs to R65: use each customer's actual planned/assigned boot asset BSL; never a shared model default or foot-size-derived BSL.

## Production-copy evidence

`tests/public/human-ui.ts` runs the existing real PostgreSQL guest APIs with the existing fake payment gateway and a test-only production-copy provider. The normal behavior-test mode retains its development notices and synthetic contact guard. The visual test aliases only an exact fictional name/address at the fixture boundary; no real customer or provider operation is introduced.

Staff capture scripts run the authenticated local application and existing fixtures. Neutral names are fixture display names. One exact synthetic contact name is aliased in read responses only; the immutable booking contract and its server guard remain intact. Premium model evidence uses an approved Salomon photograph with a neutral fixture title, not a new real inventory promise.

Customer evidence covers Japanese and English at 390px through dates, equipment, candidate, review/payment, success, reservation, recovery, cancellation preview and cancellation status. Japanese public/transaction and staff/admin evidence also includes 1440px. Full-page images and viewport images are distinct.

Current screenshot and validation manifests are `human-ui-screenshot-manifest.json` and `human-ui-validation-receipts.json`. The corresponding PNGs, full logs, fixture capture scripts and control matrices are included in `R64_HUMAN_UI_CLEANUP_EVIDENCE.zip`. Historical screenshot/validation records are retained and explicitly superseded.

## Functional control matrix disposition

| Existing matrix | Preserved behavior | Current presentation |
|---|---|---|
| audit/customer-controls.md | Same-origin mutations; request keys; revision guards; payment and recovery semantics; native controls; disabled/error states | Person card scopes field names, clear confirmation/price CTA, recovery under disclosure, QR instruction, compact BOOK heading |
| audit/staff-admin-controls.md | Session boundary; capability/store guards; mutation/version/idempotency semantics; return/transfer/financial behavior | Human labels, short references, closed technical values, task-focused BSL instruction, camera opens on request |
| audit/test-ui-dependencies.md | DB/API assertions and security outcomes retained | Presentation locators updated and disclosures explicitly opened; transfer receipt test waits for saved row state before reload |

The matrices remain historical source inventories. The cleanup disposition above supersedes their old literal copy and their old claims about which details are visible.

## Verification

See current receipts for actual commands, exit status and log hashes. Visual scans inspect rendered visible text, language, overflow, loaded authenticated content and idle camera state. Dirty-state tests cover clean step entry, a genuine edit and reversion. Local browser evidence does not claim real-device camera or hosted/provider acceptance.
