import {bookingHandler} from '../../../../../../../apps/web/src/lib/booking-http';
import {staffState} from '../../../../../../../apps/web/src/lib/staff-runtime';
import {testFlowService,testFlowOrigin} from '../../../../../../flow/test-runtime';
export const dynamic='force-dynamic';
export const GET=(r:Request)=>bookingHandler(staffState,testFlowService,testFlowOrigin(),'ISOLATED_TEST')(r);
export const POST=GET;
