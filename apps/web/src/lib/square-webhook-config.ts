import type {SquareWebhookConfiguration} from '../../../../packages/core/src/payment/square-webhook-receiver';
export const SQUARE_WEBHOOK_PATH='/api/webhooks/square';
export const SQUARE_WEBHOOK_MERCHANT='MLKDVEDH1ME21';
export type SandboxWebhookRuntimeConfiguration={receiver:SquareWebhookConfiguration;databaseUrl:string};
/** Pure resolver. No env pull, logging, network or implicit fallback to a payment credential. */
export function squareWebhookConfiguration(env:Readonly<Record<string,string|undefined>>):SandboxWebhookRuntimeConfiguration|null{
 // Production/future multi-environment transport is deliberately not composed in R11.
 if(env.ZAO_SQUARE_WEBHOOK_ACTIVATION!=='SANDBOX'||env.VERCEL_ENV!=='preview'||env.SQUARE_ENVIRONMENT!=='SANDBOX'||env.SQUARE_API_VERSION!=='2026-08-19')return null;
 if(Object.keys(env).some(name=>/^NEXT_PUBLIC_/i.test(name)&&env[name]))return null;
 const signatureKey=env.SQUARE_SANDBOX_WEBHOOK_SIGNATURE_KEY,notificationUrl=env.SQUARE_SANDBOX_NOTIFICATION_URL,databaseUrl=env.SQUARE_WEBHOOK_DATABASE_URL;
 if(!signatureKey||signatureKey.length>4096||!notificationUrl||!databaseUrl||env.SQUARE_SANDBOX_MERCHANT_ID!==SQUARE_WEBHOOK_MERCHANT)return null;
 try{
  const url=new URL(notificationUrl),db=new URL(databaseUrl);
  if(notificationUrl.length>2048||url.href!==notificationUrl||url.protocol!=='https:'||url.username||url.password||url.hash||url.search||url.pathname!==SQUARE_WEBHOOK_PATH||url.port&&url.port!=='443')return null;
  // Dedicated receiver identity; no migration/auth/booking credential fallback.
  // TLS options are fixed below, not overridden via URL sslmode parameters.
  if(!['postgres:','postgresql:'].includes(db.protocol)||db.username!=='zao_square_webhook_receiver'||!db.password||!db.hostname||db.pathname.length<2||db.search||db.hash)return null;
 }catch{return null;}
 return {receiver:{environment:'SANDBOX',merchantId:SQUARE_WEBHOOK_MERCHANT,notificationUrl,signatureKey},databaseUrl};
}
