// 0059/0060 production grants (Issue #47). Applied only after the exact 0059+0060 registry entries, never as part of the
// base application role plan (which also runs against historical prefixes). Function EXECUTE only; no table access.
export const STAFF_NOTIFICATION_FUNCTIONS=['staff_inbox_list(text[],boolean,timestamptz,uuid,integer)','staff_inbox_ack(uuid)','staff_notification_preference(boolean,text)','staff_events_sync()',
 'staff_notification_claim(uuid)','staff_notification_material(uuid,uuid)','staff_notification_settle(uuid,uuid,text,text,text)','staff_notification_unknown(uuid)','staff_notification_reconciled(uuid,text)','staff_notification_due(integer)','staff_order_contract(uuid)'] as const;
export function productionStaffNotificationGrants(database:string,operationsRole:string):string[]{
 if(!/^[a-z][a-z0-9_]{0,40}$/.test(database)||operationsRole!==database+'_operations')throw Error('PRODUCTION_STAFF_NOTIFICATION_GRANTS_REFUSED');
 return STAFF_NOTIFICATION_FUNCTIONS.map(fn=>`GRANT EXECUTE ON FUNCTION ${fn} TO ${operationsRole}`);
}

// 0061 customer identity: SELECT on the two projection tables and EXECUTE on the one link function; no INSERT/UPDATE/DELETE.
export const CUSTOMER_TABLES=['customer_profiles','customer_booking_links'] as const;
export function productionCustomerGrants(database:string,operationsRole:string):string[]{
 if(!/^[a-z][a-z0-9_]{0,40}$/.test(database)||operationsRole!==database+'_operations')throw Error('PRODUCTION_CUSTOMER_GRANTS_REFUSED');
 return [`GRANT SELECT ON ${CUSTOMER_TABLES.join(',')} TO ${operationsRole}`,`GRANT EXECUTE ON FUNCTION customer_link_legacy(uuid,uuid,text) TO ${operationsRole}`];
}
