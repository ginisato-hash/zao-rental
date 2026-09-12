import {wearHandler} from '../../../../lib/wear-http';
import {staffState,getRuntime} from '../../../../lib/staff-runtime';
export const dynamic='force-dynamic';
// The normal app never receives the isolated test role or enables synthetic custody.
export const GET=(r:Request)=>wearHandler(staffState,null,getRuntime()?.config.origin??'')(r);
export const POST=GET;
