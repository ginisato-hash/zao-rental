import type {Pool} from 'pg';
// Production connection of the group application role (`<db>_group`): the pool is offered to the customer/staff group APIs and the notification worker
// ONLY when the database really is ready for it, read with the connected role itself (catalog + privilege checks, no group data is read):
//   - migration 0064 is applied (the tables and the actor registration function exist), and
//   - the role holds exactly what the application needs on them (INSERT on the application table, the notification delivery update, EXECUTE of the actor function).
// Anything else (0064 not applied yet, a role without its grants) leaves the group APIs closed with GROUP_UNCONNECTED / GROUP_NOT_CONNECTED (503) and never
// affects the rest of the application. The check never reads or writes a row.
export async function groupRuntimeReady(pool:Pick<Pool,'query'>):Promise<boolean>{
 try{
  const r=(await pool.query<{ok:boolean}>(`SELECT CASE WHEN to_regclass('public.group_orders') IS NULL OR to_regclass('public.group_notification_outbox') IS NULL OR to_regclass('public.group_entrance') IS NULL
    OR to_regclass('public.group_events') IS NULL OR to_regprocedure('public.group_register_actor(uuid)') IS NULL THEN false ELSE (
    has_table_privilege(current_user,'public.group_orders','INSERT') AND has_table_privilege(current_user,'public.group_orders','SELECT')
    AND has_table_privilege(current_user,'public.group_events','INSERT')
    AND has_column_privilege(current_user,'public.group_notification_outbox','status','UPDATE')
    AND has_function_privilege(current_user,'public.group_register_actor(uuid)','EXECUTE')
    AND NOT has_table_privilege(current_user,'public.group_orders','DELETE')) END AS ok`)).rows[0];
  return r?.ok===true;
 }catch{return false;}
}
