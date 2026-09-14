import {squareS3Runtime} from '../../../../../lib/square-s3-runtime';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=30;
export const POST=(request:Request)=>squareS3Runtime.post(request);
