import {getProductionRuntime,productionStartupState} from '../../../../lib/production-runtime';
import {readinessDetails} from '../../../../lib/readiness-http';
import {staffState} from '../../../../lib/staff-runtime';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request){return readinessDetails(productionStartupState(),await staffState(request.headers),getProductionRuntime()?.safeStatus());}
