import 'server-only';
import {createSquareS1Preflight} from '../../../../../../lib/square-s1-acceptance';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export const GET=createSquareS1Preflight(process.env);
