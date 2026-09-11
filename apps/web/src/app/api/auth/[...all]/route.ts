import {getRuntime} from '../../../../lib/staff-runtime';
import {authHandler} from '../../../../lib/auth-http';
export const dynamic='force-dynamic';
async function handle(request:Request){const runtime=getRuntime();return authHandler(runtime?.auth??null,runtime?.authPool??null,runtime?.config.origin??null,runtime?.loginPool??null)(request);}
export const GET=handle;
export const POST=handle;
