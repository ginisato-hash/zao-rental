import type {PoolConfig} from 'pg';
import type {SquareWebhookConfiguration} from '../../../packages/core/src/payment/square-webhook-receiver';
import {EXPECTED_PRODUCTION_DATABASE_NAME,EXPECTED_PRODUCTION_HOST_FINGERPRINT_SHA256,productionHostFingerprint} from '../../../packages/auth/src/production-identity';
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

/** The one canonical Production Square webhook receiver is a separate deployment of this same small
 * ingress (never the main web app). Each deployment is exactly one classification; the secret scan
 * below and the one above each reject the other environment's credentials, so a deployment can
 * never hold both. */
export const PRODUCTION_INGRESS_CLASSIFICATION='PRODUCTION_WEBHOOK_INGRESS_ONLY';
export const WEBHOOK_PATH='/api/webhooks/square';
export type ParsedProductionIngress={configuration:IngressConfiguration;hostFingerprintSha256:string};
/** Pure structural parse; the pinned Production Neon host is checked by productionIngressConfiguration.
 * Required: exact classification, Vercel production target, notification URL equal to this project's
 * own production domain + WEBHOOK_PATH, explicit merchant, Production signature key, and a receiver
 * URL for the Production database's dedicated _pay_receipt role over verify-full TLS. */
export function parseProductionIngress(env:Environment):ParsedProductionIngress|null{
 if(env.PRODUCTION_WEBHOOK_INGRESS_CLASSIFICATION!==PRODUCTION_INGRESS_CLASSIFICATION||env.VERCEL_ENV!=='production'||!env.VERCEL_PROJECT_PRODUCTION_URL||!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(env.VERCEL_PROJECT_PRODUCTION_URL))return null;
 if(env.R15_INGRESS_CLASSIFICATION!==undefined||Object.keys(env).some(k=>/^(?:SQUARE_SANDBOX_|R15_)/.test(k)))return null;
 const allowedSecrets=new Set(['PRODUCTION_SQUARE_WEBHOOK_SIGNATURE_KEY','PRODUCTION_RECEIVER_DATABASE_URL','VERCEL_OIDC_TOKEN']);
 if(Object.entries(env).some(([key,value])=>value&&!allowedSecrets.has(key)&&/(?:TOKEN|SECRET|SIGNATURE_KEY|PASSWORD|PRIVATE_KEY|DATABASE_URL|^PG(?:HOST|PORT|USER|DATABASE)|^POSTGRES)/i.test(key)))return null;
 const signatureKey=env.PRODUCTION_SQUARE_WEBHOOK_SIGNATURE_KEY,merchantId=env.PRODUCTION_SQUARE_MERCHANT_ID,notificationUrl=`https://${env.VERCEL_PROJECT_PRODUCTION_URL}${WEBHOOK_PATH}`;
 if(!signatureKey||signatureKey.length<16||signatureKey.length>512||env.PRODUCTION_SQUARE_WEBHOOK_NOTIFICATION_URL!==notificationUrl||!merchantId||!/^[A-Za-z0-9_-]{1,100}$/.test(merchantId))return null;
 try{
  const url=new URL(env.PRODUCTION_RECEIVER_DATABASE_URL??'');
  const database=url.pathname.slice(1),user=decodeURIComponent(url.username),password=decodeURIComponent(url.password);
  if(url.protocol!=='postgresql:'||!/^ep-[a-z0-9.-]+\.neon\.tech$/.test(url.hostname)||/-pooler\./.test(url.hostname)||url.port&&url.port!=='5432'||url.hash||database!==EXPECTED_PRODUCTION_DATABASE_NAME||user!==database+'_pay_receipt'||password.length<16)return null;
  if(url.searchParams.get('sslmode')!=='verify-full'||Array.from(url.searchParams).some(([key])=>key!=='sslmode')||url.searchParams.getAll('sslmode').length!==1)return null;
  return {hostFingerprintSha256:productionHostFingerprint(url.hostname),configuration:{webhook:{environment:'PRODUCTION',signatureKey,notificationUrl,merchantId},database:{host:url.hostname,port:5432,database,user,password,ssl:{rejectUnauthorized:true},enableChannelBinding:true,max:2,connectionTimeoutMillis:5000,idleTimeoutMillis:5000,application_name:'zao_rental_production_receiver'}}};
 }catch{return null;}
}
export function productionIngressConfiguration(env:Environment):IngressConfiguration|null{
 const parsed=parseProductionIngress(env);
 return parsed&&parsed.hostFingerprintSha256===EXPECTED_PRODUCTION_HOST_FINGERPRINT_SHA256?parsed.configuration:null;
}
