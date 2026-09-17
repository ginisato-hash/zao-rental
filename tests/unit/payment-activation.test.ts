import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {migrationPlan} from '../../packages/db/src/index';
import {developmentPaymentComposition} from '../../packages/db/src/development-payment-composition';
import type {InboxPool} from '../../packages/db/src/square-webhook-inbox';
import {id} from '../fixtures/payment-projection';
test('additive migration plan has one ordered entry per version, no duplicates',()=>{assert.deepEqual(migrationPlan.map(m=>m.id),Array.from({length:34},(_,i)=>String(i+1).padStart(4,'0')));});
test('target-scoped development SQL preserves R12 state machine and adds only pre-lock selection limits',()=>{
 const old=readFileSync('packages/db/migrations/0026_payment_reconciliation.sql','utf8');let actual=readFileSync('packages/db/migrations/0029_development_payment_scope.sql','utf8');
 actual=actual.slice(actual.indexOf('CREATE FUNCTION'),actual.indexOf('\nREVOKE ALL'));
 actual=actual.replace('dispatch_target(p_environment text,p_limit integer,p_merchant text,p_payment text)','dispatch(p_environment text,p_limit integer)').replace('claim_target(p_environment text,p_owner text,p_limit integer,p_merchant text,p_payment text)','claim(p_environment text,p_owner text,p_limit integer)').replaceAll(/ IF current_database\(\).*?END IF;\n/g,'').replace(' AND i.merchant_id=p_merchant AND i.payment_id=p_payment','').replace(' AND x.merchant_id=p_merchant AND x.payment_id=p_payment','');
 assert.equal(actual.trim(),old.slice(old.indexOf('CREATE FUNCTION payment_reconciliation.dispatch('),old.indexOf('CREATE FUNCTION payment_reconciliation.finalize(')).trim());
});
test('production refuses injected development composition before any DB/provider call',()=>{
 const pool:InboxPool={async connect(){throw new Error('DB_MUST_NOT_BE_TOUCHED');}},pools={receiver:pool,dispatcher:pool,worker:pool,projector:pool,diagnostic:pool},old=process.env.NODE_ENV;
 try{(process.env as Record<string,string|undefined>).NODE_ENV='production';assert.throws(()=>developmentPaymentComposition(pools,{environment:'SANDBOX',merchantId:'fixture-merchant',notificationUrl:'https://fixture.invalid/webhook',signatureKey:'synthetic-test-key'},{bookingId:id(1),attemptId:id(4),paymentId:'fixture-payment'},{async lookupPayment(){throw new Error('PROVIDER_MUST_NOT_BE_TOUCHED');}}),/R14_DEVELOPMENT_ONLY/);}finally{if(old===undefined)delete (process.env as Record<string,string|undefined>).NODE_ENV;else (process.env as Record<string,string|undefined>).NODE_ENV=old;}
});
test('development composition is absent from ordinary application imports',()=>{
 function files(path:string):string[]{return readdirSync(path,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(join(path,e.name)):/\.tsx?$/.test(e.name)?[join(path,e.name)]:[]);}
 for(const path of files('apps/web/src'))assert.doesNotMatch(readFileSync(path,'utf8'),/developmentPaymentComposition|development-payment-composition|payment-activation-roles/);
});
