import {Pool} from 'pg';
import {squareWebhookReceiver} from '../../../packages/core/src/payment/square-webhook-receiver';
import {PgSquareWebhookInbox} from '../../../packages/db/src/square-webhook-inbox';
import {ingressConfiguration,INGRESS_CLASSIFICATION,type IngressConfiguration} from './config';
import type {SquareWebhookInbox} from '../../../packages/core/src/payment/square-webhook-inbox';
function reply(status:number,classification:string,allow?:string){return Response.json({classification},{status,headers:{'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow',...(allow?{Allow:allow}:{})}});}
/** Exported factory permits fixture verification without opening a DB or changing process env. */
export function ingressHandler(config:IngressConfiguration|null,inbox:()=>SquareWebhookInbox){
 const receive=squareWebhookReceiver(config?.webhook??null,inbox);
 return async(request:Request):Promise<Response>=>{
  const url=new URL(request.url);
  if(url.pathname==='/health')return request.method==='GET'?reply(200,INGRESS_CLASSIFICATION):reply(405,'METHOD_NOT_ALLOWED','GET');
  if(url.pathname!=='/api/webhooks/square')return reply(404,'NOT_FOUND');
  if(url.search)return reply(400,'QUERY_NOT_ALLOWED');
  return receive(request);
 };
}
// No top-level DB connection, background worker, provider client or log sink.
const config=ingressConfiguration(process.env);let pool:Pool|undefined;
export const handle=ingressHandler(config,()=>{
 if(!config)throw new Error('INGRESS_NOT_CONFIGURED');
 if(!pool){pool=new Pool(config.database);pool.on('error',()=>{/* Never log driver details or credentials. */});}
 return new PgSquareWebhookInbox(pool);
});
