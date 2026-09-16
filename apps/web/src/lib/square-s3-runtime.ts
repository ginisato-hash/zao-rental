import 'server-only';
import {createSquareS3Acceptance} from './square-s3-acceptance';
export const squareS3Runtime=createSquareS3Acceptance(process.env,(url,init)=>fetch(url,init));
