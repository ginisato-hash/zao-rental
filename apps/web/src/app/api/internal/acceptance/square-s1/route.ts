import 'server-only';
import {createSquareS1Acceptance} from '../../../../../lib/square-s1-acceptance';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export const maxDuration=20;
const accept=createSquareS1Acceptance(process.env,(url,init)=>fetch(url,init));
// No GET export, UI link, prerender, scheduled trigger, payment or DB composition.
export const POST=accept;
