import {getRuntime,staffState} from '../../../../lib/staff-runtime';
import {operationsHandler} from '../../../../lib/operations-http';
import {OperationsContext} from '../../../../../../../packages/core/src/operations/context';
export const dynamic='force-dynamic';
export function GET(request:Request){const r=getRuntime();return operationsHandler(staffState,r?.operationsPool?identity=>new OperationsContext(r.operationsPool!,r.authPool,identity):null,r?.config.origin??'')(request);}
export const POST=GET;
