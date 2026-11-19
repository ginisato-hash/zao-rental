import {staffState,getRuntime} from '../../../../lib/staff-runtime';
import {staffOrderHandler} from '../../../../lib/staff-order-http';
import {productionRequested,getProductionRuntime} from '../../../../lib/production-runtime';
export const dynamic='force-dynamic';
// Only the Production composition carries the verified commercial identity, payment binding and price authority.
// Local development has none, so the route answers 503 rather than simulating a charge.
async function handle(request:Request){const p=productionRequested()?getProductionRuntime():null;return staffOrderHandler(staffState,p?.staffOrders??null,getRuntime()?.config.origin??'')(request);}
export const GET=handle;export const POST=handle;
