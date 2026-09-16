import 'server-only';
import {Pool} from 'pg';
import {PgSquareWebhookInbox} from '../../../../packages/db/src/square-webhook-inbox';
import {squareWebhookReceiver} from '../../../../packages/core/src/payment/square-webhook-receiver';
import {squareWebhookConfiguration} from './square-webhook-config';
let runtime:{databaseUrl:string;pool:Pool;inbox:PgSquareWebhookInbox}|undefined;
/** Lazy: build/missing activation/invalid signature cannot create a pool or query a DB. */
export function handleSquareWebhook(request:Request){
 const config=squareWebhookConfiguration(process.env);
 return squareWebhookReceiver(config?.receiver??null,()=>{
  if(!config)throw new Error('WEBHOOK_NOT_CONFIGURED');
  // Runtime credential changes require restart; no leaked second pool or fallback identity.
  if(runtime&&runtime.databaseUrl!==config.databaseUrl)throw new Error('WEBHOOK_RESTART_REQUIRED');
  if(!runtime){
   const pool=new Pool({connectionString:config.databaseUrl,ssl:{rejectUnauthorized:true},max:2,
    connectionTimeoutMillis:2000,idleTimeoutMillis:10000,statement_timeout:2500,query_timeout:3000,allowExitOnIdle:true});
   pool.on('error',()=>{});runtime={databaseUrl:config.databaseUrl,pool,inbox:new PgSquareWebhookInbox(pool)};
  }
  return runtime.inbox;
 })(request);
}
