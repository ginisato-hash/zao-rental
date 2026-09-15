import type {PoolConfig} from 'pg';
import type {SquareWebhookConfiguration} from '../../../packages/core/src/payment/square-webhook-receiver';
export const INGRESS_CLASSIFICATION='SANDBOX_WEBHOOK_INGRESS_ONLY';
export const INGRESS_DOMAIN='zao-rental-webhook-sandbox.vercel.app';
export const NOTIFICATION_URL=`https://${INGRESS_DOMAIN}/api/webhooks/square`;
export const MERCHANT_ID='MLKDVEDH1ME21';
type Environment=Readonly<Record<string,string|undefined>>;
export type IngressConfiguration={webhook:SquareWebhookConfiguration;database:PoolConfig};
/** Receiver-only composition: no fallback URL, inherited main-app credentials or host-header authority. */
export function ingressConfiguration(env:Environment):IngressConfiguration|null{
 if(env.R15_INGRESS_CLASSIFICATION!==INGRESS_CLASSIFICATION||env.VERCEL_ENV!=='production'||env.VERCEL_PROJECT_PRODUCTION_URL!==INGRESS_DOMAIN)return null;
 const allowedSecrets=new Set(['SQUARE_SANDBOX_WEBHOOK_SIGNATURE_KEY','R15_RECEIVER_DATABASE_URL','VERCEL_OIDC_TOKEN']);
 if(Object.entries(env).some(([key,value])=>value&&!allowedSecrets.has(key)&&/(?:TOKEN|SECRET|SIGNATURE_KEY|PASSWORD|PRIVATE_KEY|DATABASE_URL|^PG(?:HOST|PORT|USER|DATABASE)|^POSTGRES)/i.test(key)))return null;
 const signatureKey=env.SQUARE_SANDBOX_WEBHOOK_SIGNATURE_KEY;
 if(!signatureKey||signatureKey.length<16||signatureKey.length>512||env.SQUARE_SANDBOX_NOTIFICATION_URL!==NOTIFICATION_URL||env.SQUARE_SANDBOX_MERCHANT_ID!==MERCHANT_ID)return null;
 try{
  const url=new URL(env.R15_RECEIVER_DATABASE_URL??'');
  const database=url.pathname.slice(1),user=decodeURIComponent(url.username),password=decodeURIComponent(url.password);
  if(url.protocol!=='postgresql:'||!/^ep-[a-z0-9.-]+\.neon\.tech$/.test(url.hostname)||url.port&&url.port!=='5432'||url.hash||!/^zr_[a-f0-9]{12}$/.test(database)||user!==database+'_pay_receipt'||!password)return null;
  if(url.searchParams.get('sslmode')!=='verify-full'||Array.from(url.searchParams).some(([key])=>key!=='sslmode')||url.searchParams.getAll('sslmode').length!==1)return null;
  return {webhook:{environment:'SANDBOX',signatureKey,notificationUrl:NOTIFICATION_URL,merchantId:MERCHANT_ID},database:{host:url.hostname,port:5432,database,user,password,ssl:{rejectUnauthorized:true},max:2,connectionTimeoutMillis:5000,idleTimeoutMillis:5000,application_name:'zao_rental_r15_receiver'}};
 }catch{return null;}
}
