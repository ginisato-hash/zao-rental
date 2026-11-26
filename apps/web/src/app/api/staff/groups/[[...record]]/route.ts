import type {Pool} from 'pg';
import {getRuntime,staffState} from '../../../../../lib/staff-runtime';
import {staffGroupHandler} from '../../../../../lib/staff-group-http';
import {GroupOrderService} from '../../../../../../../../packages/core/src/group/group-service';
export const dynamic='force-dynamic';
// The dedicated group database role is composed only where it is provisioned (the local development launcher today). Without it the routes
// answer 503; nothing falls back to another role or simulates a group operation.
const services=new WeakMap<object,GroupOrderService>();
function facade(){const r=getRuntime() as unknown as {groupPool?:Pool|null}|null;const pool=r?.groupPool;if(!pool)return null;let s=services.get(pool);if(!s){s=new GroupOrderService(pool);services.set(pool,s);}return s;}
async function handle(request:Request){return staffGroupHandler(staffState,()=>facade(),getRuntime()?.config.origin??'')(request);}
export const GET=handle;export const POST=handle;
