import type {Pool} from 'pg';
/** Role delta for the group notification worker, applied to the dedicated group application role (`<database>_group`) on top of
 * `provisionGroupRole`. 0064 gives that role SELECT+INSERT on group_notification_outbox (the state-commit transaction inserts the
 * row). The delivery worker additionally needs to lease and settle rows, so it receives UPDATE on the delivery-bookkeeping
 * columns ONLY - never on group_id, event_id, event_type, dedupe_key, locale, template_version or admin_message (what the
 * notice is, and for whom, stays immutable). Production applies the same statement through the reviewed role-delta procedure;
 * nothing here touches a production database. */
export const GROUP_NOTIFICATION_DELIVERY_COLUMNS=['status','attempt_count','next_attempt_at','claim_id','claim_until','provider_message_id','sent_at','last_safe_failure_code'] as const;
export const groupNotificationRoleDelta=(role:string)=>{
 if(!/^[a-z_][a-z0-9_]{0,62}$/.test(role))throw new Error('INVALID_ROLE');
 return `GRANT UPDATE(${GROUP_NOTIFICATION_DELIVERY_COLUMNS.join(',')}) ON group_notification_outbox TO ${role}`;
};
export async function grantGroupNotificationDelta(owner:Pool,database:string){
 if(!/^zr_[a-f0-9]{12}$/.test(database))throw new Error('INVALID_OWNED_DATABASE');
 await owner.query(groupNotificationRoleDelta(database+'_group'));
}
