import {getRuntime,staffState} from '../../../../lib/staff-runtime';
import {custodyHandler} from '../../../../lib/custody-http';
import {CustodyService} from '../../../../../../../packages/core/src/rental/custody-service';
import {FlowError} from '../../../../../../../packages/contracts/src/rental-flow';
export const dynamic='force-dynamic';
async function handle(request:Request){const r=getRuntime();return custodyHandler(staffState,identity=>{if(!r?.operationsPool)throw new FlowError('CUSTODY_NOT_CONNECTED',503);return new CustodyService(r.operationsPool,r.authPool,identity);},r?.config.origin??'',r?.operationsPool?'LOCAL_OPERATIONS':'UNCONNECTED')(request);}
export const GET=handle;export const POST=handle;
