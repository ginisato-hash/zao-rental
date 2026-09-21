import {productionStartupState} from '../../../lib/production-runtime';
import {readinessResponse} from '../../../lib/readiness-http';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export function GET(){return readinessResponse(productionStartupState());}
