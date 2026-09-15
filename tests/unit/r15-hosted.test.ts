import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {hostedNamespace,hostedRoleConfiguration,validateHostedIdentity,type HostedDevelopmentIdentity} from '../../scripts/hosted-payment-activation';
import {paymentActivationGrants,paymentActivationRoleNames} from '../../scripts/payment-activation-grants';
function identity():HostedDevelopmentIdentity{return {resourceId:'fixture-resource',hostname:'ep-fixture.us-east-1.aws.neon.tech',namespace:hostedNamespace('fixture-resource'),authority:'P6_R15',classification:'ZAO_RENTAL_SANDBOX_DEVELOPMENT',incrementalCostJpy:0};}
test('R15 hosted setup requires fixed resource identity and zero incremental cost',()=>{
 const i=identity();validateHostedIdentity(i);
 for(const patch of [{namespace:'neondb'},{namespace:'zr_123456789abc'},{hostname:'ep-fixture.neon.tech.invalid'},{authority:'OTHER'},{classification:'PRODUCTION'},{incrementalCostJpy:1},{resourceId:''}])assert.throws(()=>validateHostedIdentity({...i,...patch} as HostedDevelopmentIdentity),/R15_HOSTED_IDENTITY_REJECTED/);
 const c=hostedRoleConfiguration(i,paymentActivationRoleNames(i.namespace).receiver,randomBytes(32).toString('hex'));assert.deepEqual(c.ssl,{rejectUnauthorized:true});assert.equal(c.database,i.namespace);assert.throws(()=>hostedRoleConfiguration(i,'neondb_owner','fixture'),/R15_ROLE_REJECTED/);
});
test('R15 shared role grants retain R14 privileges except removal of unscoped dispatch/claim',()=>{
 const n=identity().namespace,old=paymentActivationGrants(n,'R14_LOCAL'),now=paymentActivationGrants(n,'R15_TARGETED');
 assert.equal(old.length,now.length);assert.deepEqual(now,old.map(s=>s.replace('payment_reconciliation.dispatch(text,integer),','').replace('payment_reconciliation.claim(text,text,integer),','')));
 assert.ok(now.some(s=>s.includes('dispatch_target')));assert.ok(now.some(s=>s.includes('claim_target')));assert.ok(now.every(s=>!s.includes('GRANT ALL')&&!/GRANT .* TO PUBLIC/.test(s)));
 assert.equal(now.filter(s=>s.includes(' TO '+n+'_pay_receipt')).length,2);assert.equal(now.filter(s=>s.startsWith('GRANT UPDATE')&&s.includes('_pay_truth')).length,0);
});
