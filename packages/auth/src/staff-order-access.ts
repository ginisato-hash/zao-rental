/** One rule for staff New order (Issue #47 TD FB #7010252887 §3), used by the shell button, the Orders button, the New order
 * page, the /api/staff-orders handler and the staff draft store's in-transaction DB check. It is exactly what the shared
 * booking flow itself needs: recommendation/HOLD (HOLD_VIEW, HOLD_EDIT), the private quote (QUOTE_VIEW, QUOTE_CREATE) and the
 * booking (BOOKING_VIEW, BOOKING_CREATE), plus at least one station in scope. No role or permission is added by this rule. */
export const STAFF_NEW_ORDER_PERMISSIONS=['BOOKING_VIEW','BOOKING_CREATE','HOLD_VIEW','HOLD_EDIT','QUOTE_VIEW','QUOTE_CREATE'] as const;
export function canCreateStaffOrder(p:{permissions:readonly string[];storeIds:readonly string[]}):boolean{
 return p.storeIds.length>0&&STAFF_NEW_ORDER_PERMISSIONS.every(x=>p.permissions.includes(x));
}
/** A New order's pickup and return stations must both be in the staff member's scope. */
export function staffOrderStoresAllowed(p:{storeIds:readonly string[]},stores:readonly unknown[]):boolean{
 return stores.every(s=>typeof s==='string'&&p.storeIds.includes(s));
}
