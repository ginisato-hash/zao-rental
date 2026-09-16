import {getRuntime,staffState} from '../../../../lib/staff-runtime';
import {bookingHandler} from '../../../../lib/booking-http';
import {BookingService} from '../../../../../../../packages/core/src/payment/booking-service';
import {FlowError} from '../../../../../../../packages/contracts/src/rental-flow';
export const dynamic='force-dynamic';
async function handle(request:Request){const r=getRuntime();return bookingHandler(staffState,identity=>{if(!r?.operationsPool)throw new FlowError('PAYMENT_NOT_CONNECTED_CHARGE_DISABLED',503);return new BookingService(r.operationsPool,r.authPool,identity);},r?.config.origin??'',r?.operationsPool?'LOCAL_OPERATIONS':'UNCONNECTED')(request);}
export const GET=handle;export const POST=handle;
