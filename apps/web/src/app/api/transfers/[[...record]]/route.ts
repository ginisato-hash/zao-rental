import {getRuntime,staffState} from '../../../../lib/staff-runtime';
import {transferHandler} from '../../../../lib/transfer-http';
import {TransferService} from '../../../../../../../packages/core/src/transfer/transfer-service';
export const dynamic='force-dynamic';
async function handle(request:Request){const r=getRuntime();return transferHandler(staffState,p=>{if(!r)throw new Error('STORAGE_NOT_CONNECTED');return new TransferService(r.transferPool,p);},r?.config.origin??'')(request);}
export const GET=handle;export const POST=handle;
