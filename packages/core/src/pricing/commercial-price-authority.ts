// F8 (TD correction): architecture only — this pass does not, and must not, make
// `chargeReady:true` real. `packages/contracts/src/pricing.ts`'s `chargeReady:false as const` is
// a hardcoded literal produced by every pricing calculation today, asserting "this pricing output
// has never been reviewed for real commercial charging" (see RESULT.md §7/R6-D). Whether the
// current pricing calculation is authoritative enough to charge real money against is a
// business/pricing decision this integration pass does not make — fabricating a path that
// produces `chargeReady:true` (e.g. a stub that always approves) would be worse than not building
// one: it would look activated without ever having been reviewed.
//
// This module is the capability a real commercial-pricing decision would need to mint before any
// Production booking/payment create path (SQUARE_PRODUCTION booking creation, a
// `chargeReady:true` quote, a real Square CreatePayment) could exist. No such Production booking
// path exists yet (R6-D is fail-closed — production-projection-authority.ts's
// PRODUCTION_BOOKING_PATH_NOT_ACTIVATED), so this capability is deliberately unreachable and
// unwired: there is no `issueApprovedCommercialPricePermit`-equivalent constructor here that
// production code can call, because the reviewed approval it would require does not exist. When a
// real commercial-price decision is made, the issuing side belongs here, gated on that explicit,
// separately-reviewed approval — never on a runtime flag or environment check alone.
export type CommercialPriceAuthority = Readonly<{ kind: 'COMMERCIAL_PRICE_AUTHORITY' }>;
export type ApprovedCommercialPricePermit = Readonly<{ kind: 'APPROVED_COMMERCIAL_PRICE_PERMIT' }>;
const issued = new WeakMap<ApprovedCommercialPricePermit, Readonly<{ authority: CommercialPriceAuthority }>>();
export function approvedCommercialPricePermitAuthority(permit?: ApprovedCommercialPricePermit): CommercialPriceAuthority | null {
  return permit ? issued.get(permit)?.authority ?? null : null;
}
