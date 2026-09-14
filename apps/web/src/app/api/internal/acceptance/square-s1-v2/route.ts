import 'server-only';
import {createSquareS1AcceptanceV2} from '../../../../../lib/square-s1-acceptance';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export const maxDuration=20;
export const POST=createSquareS1AcceptanceV2(process.env,(url,init)=>fetch(url,init));
