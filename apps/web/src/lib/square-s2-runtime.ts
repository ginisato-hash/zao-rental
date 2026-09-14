import 'server-only';
import {createSquareS2Acceptance} from './square-s2-acceptance';
export const squareS2Runtime=createSquareS2Acceptance(process.env,(url,init)=>fetch(url,init));
