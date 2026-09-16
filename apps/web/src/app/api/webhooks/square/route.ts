import {handleSquareWebhook} from '../../../../lib/square-webhook-runtime';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const POST=handleSquareWebhook;
export function GET(){return Response.json({classification:'METHOD_NOT_ALLOWED'},{status:405,headers:{Allow:'POST','Cache-Control':'no-store'}});}
export const HEAD=GET;
export const OPTIONS=GET;
export const PUT=GET;
export const PATCH=GET;
export const DELETE=GET;
