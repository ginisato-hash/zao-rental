import {wearHandler} from '../../../../../../../apps/web/src/lib/wear-http';
import {staffState} from '../../../../../../../apps/web/src/lib/staff-runtime';
import {testWearService,testFlowOrigin} from '../../../../../../flow/test-runtime';
export const dynamic='force-dynamic';
export const GET=(r:Request)=>wearHandler(staffState,testWearService,testFlowOrigin())(r);
export const POST=GET;
