import {wearHandler} from '../../../../lib/wear-http';
import {staffState,getRuntime} from '../../../../lib/staff-runtime';
import {WearService} from '../../../../../../../packages/core/src/wear/service';
export const dynamic='force-dynamic';
export const GET=(request:Request)=>{const r=getRuntime();return wearHandler(staffState,r?.operationsPool?identity=>new WearService(r.operationsPool!,r.authPool,identity):null,r?.config.origin??'')(request);};
export const POST=GET;
