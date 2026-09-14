import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomBytes} from 'node:crypto';
import {sandboxActivationMetadata,verifySandboxReceiver,sandboxAccessResolver,type SandboxSecretResolver} from '../../packages/core/src/payment/sandbox-preflight';
import {SQUARE_VERSION} from '../../packages/core/src/payment/square-sandbox';
const now=new Date('2035-01-01T12:00:00Z');
const fixture=()=>({revision:'SYNTHETIC-P5',environment:'SANDBOX',applicationId:'synthetic-app',merchantId:'synthetic-merchant',locations:{MOUNTAIN_BASE:'synthetic-mountain',ONSEN_BASE:'synthetic-onsen'},apiVersion:SQUARE_VERSION,notificationUrl:'https://fixture.invalid/sandbox-webhook',secretStoreId:'synthetic-memory',accessKeyId:'synthetic-access',webhookKeys:[{purpose:'SQUARE_WEBHOOK',keyId:'new',state:'ACTIVE',notBefore:'2035-01-01T00:00:00Z',expiresAt:'2035-01-03T00:00:00Z',graceUntil:null},{purpose:'SQUARE_WEBHOOK',keyId:'old',state:'RETIRING',notBefore:'2034-12-31T00:00:00Z',expiresAt:'2035-01-02T00:00:00Z',graceUntil:'2035-01-01T13:00:00Z'}],paymentLimit:20,refundLimit:5,redirectPolicy:'FIXED_ORIGIN_NO_PAYMENT_AUTHORITY',activation:'DISABLED'});
test('P5 activation metadata rejects production, missing/mixed mapping, credentials and automatic enablement',()=>{const c=fixture();assert.equal(sandboxActivationMetadata(c,now).activation,'DISABLED');for(const patch of [{environment:'PRODUCTION'},{activation:'ENABLED'},{accessToken:'forbidden'},{applicationId:''},{notificationUrl:'http://fixture.invalid'},{notificationUrl:'https://fixture.invalid/?secret=x'},{paymentLimit:21},{locations:{MOUNTAIN_BASE:'same',ONSEN_BASE:'same'}}])assert.throws(()=>sandboxActivationMetadata({...c,...patch},now));});
test('P5 dual webhook keys verify exact URL/raw bytes, retire exactly at grace and never expose secret',async()=>{
 const c=sandboxActivationMetadata(fixture(),now),values={new:randomBytes(32).toString('hex'),old:randomBytes(32).toString('hex')},raw=Buffer.from(JSON.stringify({event_id:'fixture-event',merchant_id:c.merchantId,type:'payment.updated',data:{object:{payment:{id:'fixture-payment'}}}}));let accesses=0;
 const resolver:SandboxSecretResolver={async access(){accesses++;throw new Error('NOT_USED');},async webhook(keyId){return {keyId,value:values[keyId as keyof typeof values]};}};
 const sign=(key:string,url=c.notificationUrl)=>createHmac('sha256',key).update(url).update(raw).digest('base64'),signal=new AbortController().signal;
 for(const keyId of ['old','new'] as const){const r=await verifySandboxReceiver(c,resolver,raw,sign(values[keyId]),now,signal);assert.equal(r.keyId,keyId);assert.equal(JSON.stringify(r).includes(values[keyId]),false);}
 await assert.rejects(verifySandboxReceiver(c,resolver,raw,sign(values.old),new Date('2035-01-01T13:00:00Z'),signal),{code:'WEBHOOK_SIGNATURE_REJECTED'});
 await assert.rejects(verifySandboxReceiver(c,resolver,Buffer.concat([raw,Buffer.from(' ')]),sign(values.new),now,signal),{code:'WEBHOOK_SIGNATURE_REJECTED'});
 await assert.rejects(verifySandboxReceiver(c,resolver,raw,sign(values.new,c.notificationUrl+'/'),now,signal),{code:'WEBHOOK_SIGNATURE_REJECTED'});assert.equal(accesses,0);
 const bad={...resolver,async access(){return {environment:'SANDBOX' as const,merchantId:'other',locationId:c.locations.MOUNTAIN_BASE,accessToken:randomBytes(32).toString('hex'),expiresAt:new Date('2036-01-01'),revoked:false};}};
 await assert.rejects(sandboxAccessResolver(c,bad,'MOUNTAIN_BASE')(signal),{code:'SQUARE_AUTH_STOP'});
});
