# R64 takeover reconciliation

Authority: Issue #47 comments [6148169405](https://github.com/ginisato-hash/zao-rental/issues/47#issuecomment-6148169405) and [6149495262](https://github.com/ginisato-hash/zao-rental/issues/47#issuecomment-6149495262).

Recovered in place from two local commits, 374638b and 4091d19, based exactly on e1abb2e. The original working/index binary patches, full source, ignored R64 evidence and both commits were preserved on the Owner-specified SSD before edits. No fresh implementation branch was created.

## Classification at takeover

A = complete implementation aligned with R64 (retained); B = aligned but evidence/polish incomplete (completed in place); C = conflict needing a bounded correction; D = unrelated/generated.

| Files / area | Class | Disposition |
|---|---|---|
| shared tokens; guest/staff/ledger/operations/recommendation CSS; branding labels | B | Retain design work. Verify actual authorized staff pages and transaction states; historical captures alone are insufficient. |
| PublicPage, PublicChrome, public.css, PriceExplorer | B | Retain home, public content, menu, scroll reveals, price explorer. Fix invisible secondary menu controls and small utility touch targets. |
| BookingAccess / GuestBooking / GuestRecovery; reservation, legal and Premium pages | B | Retain JSX and CSS changes; complete recovery/cancellation evidence and copy review. |
| approved product derivatives, media mappings and S mark | A | Preserve originals and ASSETS provenance. No new image generation or downloaded third-party imagery. |
| removed HomeCampaigns / BrandMark / stacked logo files | A | Keep removal of the superseded P85 visual layer; navigation/booking actions remain available. |
| price-rows and price-rows tests | B | Keep authoritative-table lookup; add independent quote-input comparison for 220 display cells. |
| public UI test replacement | C | The RGB opacity parser falsely treated opaque black as alpha zero. Correct parser, preserve all keyboard/inert/scroll/focus assertions, and add hover/focus visibility and reduced motion checks. |
| public content copy | C | Keep jargon removal. Clarify that availability is a prerequisite, not sufficient confirmation, and avoid saying an estimate fixes payment before payment qualification. |
| next-env.d.ts | D | Generated dev-mode reference; normal typegen/build restores canonical production reference. Not an intended candidate change. |
| ignored LP audit, control matrices, parity draft, screenshots and tools | B | Preserve all originals. Promote audit/parity documents with historical findings explicitly distinguished from final evidence. Replace invalid staff acceptance images with real authorized renders. |

## Scope boundary

No API handler, pricing table/value, pricing calculation, inventory/HOLD/recommendation algorithm, booking/payment/refund/cancellation backend, auth/session/permission code, notification backend, schema/migration, worker, environment, publication or deployment configuration is changed. Existing local synthetic test fixtures provide evidence; no real provider/payment/refund calls are authorized or needed.

## Complete recovered product/test path list

- `apps/web/src/app/[locale]/legal/[doc]/page.tsx`
- `apps/web/src/app/[locale]/rental/premium/[slug]/page.tsx`
- `apps/web/src/app/[locale]/reservation/page.tsx`
- `apps/web/src/app/globals.css`
- `apps/web/src/app/staff/login/page.tsx`
- `apps/web/src/components/AvatarCustomerPreview.tsx`
- `apps/web/src/components/BookingAccess.tsx`
- `apps/web/src/components/BookingWorkspace.tsx`
- `apps/web/src/components/BrandMark.tsx`
- `apps/web/src/components/CustodyWorkspace.tsx`
- `apps/web/src/components/GuestBooking.tsx`
- `apps/web/src/components/GuestRecovery.tsx`
- `apps/web/src/components/HoldWorkspace.tsx`
- `apps/web/src/components/HomeCampaigns.tsx`
- `apps/web/src/components/PriceExplorer.tsx`
- `apps/web/src/components/PublicChrome.tsx`
- `apps/web/src/components/PublicPage.tsx`
- `apps/web/src/components/QuoteWorkspace.tsx`
- `apps/web/src/components/RecommendationWorkspace.tsx`
- `apps/web/src/components/StaffHome.tsx`
- `apps/web/src/components/StaffLedger.tsx`
- `apps/web/src/components/TransferWorkspace.tsx`
- `apps/web/src/components/avatar.css`
- `apps/web/src/components/brand/index.ts`
- `apps/web/src/components/brand/logo-stacked-black.webp`
- `apps/web/src/components/brand/logo-stacked-white.webp`
- `apps/web/src/components/brand/media.ts`
- `apps/web/src/components/brand/product-assassin-1280.webp`
- `apps/web/src/components/brand/product-assassin-800.webp`
- `apps/web/src/components/brand/product-qst-1280.webp`
- `apps/web/src/components/brand/product-qst-800.webp`
- `apps/web/src/components/brand/product-smax8-1280.webp`
- `apps/web/src/components/brand/product-smax8-800.webp`
- `apps/web/src/components/brand/salomon-s-path.ts`
- `apps/web/src/components/guest.css`
- `apps/web/src/components/holds.css`
- `apps/web/src/components/ledger/ledger.css`
- `apps/web/src/components/operations.css`
- `apps/web/src/components/price-rows.ts`
- `apps/web/src/components/public.css`
- `apps/web/src/components/recommendation.css`
- `apps/web/src/components/staff-home.css`
- `config/content/public-p0-pages.json`
- `tests/public/normal-ui.ts`
- `tests/unit/price-rows.test.ts`
