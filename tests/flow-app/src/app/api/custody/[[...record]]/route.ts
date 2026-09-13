import {custodyHandler} from '../../../../../../../apps/web/src/lib/custody-http';
import {staffState} from '../../../../../../../apps/web/src/lib/staff-runtime';
import {testCustodyService,testFlowOrigin} from '../../../../../../flow/test-runtime';
export const dynamic='force-dynamic';
export const GET=(r:Request)=>custodyHandler(staffState,testCustodyService,testFlowOrigin(),'ISOLATED_TEST')(r);
export const POST=GET;
