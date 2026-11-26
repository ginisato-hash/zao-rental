import {groupHandler} from '../../../../lib/group-http';
import {groupBoundary} from '../../../../lib/group-runtime';
export const dynamic='force-dynamic';
const handle=groupHandler(()=>groupBoundary());
export const GET=handle;
export const POST=handle;
