import {getRuntime,staffState} from '../../../../lib/staff-runtime';
import {bookingHandler} from '../../../../lib/booking-http';
import {FlowError} from '../../../../../../../packages/contracts/src/rental-flow';
export const dynamic='force-dynamic';
// Normal application has no simulated gateway import, environment toggle or charge path.
async function handle(request:Request){return bookingHandler(staffState,()=>{throw new FlowError('PAYMENT_NOT_CONNECTED_CHARGE_DISABLED',503);},getRuntime()?.config.origin??'','UNCONNECTED')(request);}
export const GET=handle;export const POST=handle;
