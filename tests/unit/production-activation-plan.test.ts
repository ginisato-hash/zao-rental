import test from 'node:test';
import assert from 'node:assert/strict';
import {productionActivationPlan} from '../../scripts/production-activation-plan';
import {migrationPlan} from '../../packages/db/src/index';

const source={head:'0'.repeat(40),tree:'1'.repeat(40),clean:true};
test('activation plan is deterministic, no-write and bound to the canonical migration set and role plans',async()=>{
 const a=await productionActivationPlan(source),b=await productionActivationPlan(source);
 assert.equal(a.planDigestSha256,b.planDigestSha256);assert.match(a.planDigestSha256,/^[a-f0-9]{64}$/);
 assert.deepEqual([a.writes,a.networkRequests,a.valuesRead],[0,0,0]);
 assert.equal(a.target.database,'neondb');assert.equal(a.bootstrap.canonicalMigrations,migrationPlan.length);assert.equal(a.bootstrap.lastMigration,migrationPlan.at(-1)!.id);
 assert.ok(a.roles.payment.names.includes('neondb_pay_receipt'));assert.equal(a.credentials.webhookIngress.receiverRole,'neondb_pay_receipt');
 assert.equal(a.nextWriteStep.gate,'PRODUCTION_CREDENTIAL_CANARY');assert.match(a.nextWriteStep.action,/neondb_content_read/);
 assert.equal(a.roleProvisioning.roleProvisioningVersion,'production-role-provisioning/1');assert.equal(a.roleProvisioning.managerRole,'neondb_role_admin');assert.equal(a.roleProvisioning.operationalRoles.length,17);
 assert.match(a.roleProvisioning.foundationPlanSha256,/^[a-f0-9]{64}$/);assert.equal(a.roleProvisioning.binding.bootstrapPlanSha256,a.bootstrap.planSha256);
 assert.equal(a.credentialActivation.version,'production-credential-activation/5');assert.equal(a.credentialActivation.initialPasswordAuthority,'SQL_TEMPORARY_PLAINTEXT_NOLOGIN');assert.equal(a.credentialActivation.steadyStatePasswordAuthority,'NEON_ROLE_RESET_PASSWORD_API');assert.equal(a.credentialActivation.roleAttributeAuthority,'neondb_role_admin');
 assert.equal(a.credentialActivation.temporaryPasswordRoleState,'NOLOGIN');assert.equal(a.credentialActivation.finalPasswordSource,'NEON_RESET_RESPONSE');assert.equal(a.credentialActivation.temporaryPasswordInstalledInVercel,false);assert.equal(a.credentialActivation.futureRotation,'FUTURE_LIVE_ROTATION_REQUIRES_SEPARATE_COORDINATION');
 assert.equal(a.credentialActivation.preFinalizationPasswordLease,'REQUIRED');assert.equal(a.credentialActivation.passwordLeaseMinutes,20);assert.equal(a.credentialActivation.sinkOrdering,'AFTER_RESTART_PERSISTENCE');
 assert.equal(a.credentialActivation.containmentSql,'NOLOGIN_PASSWORD_NULL_VALID_UNTIL_INFINITY_IDEMPOTENT');assert.match(a.nextWriteStep.rollback,/NOLOGIN PASSWORD NULL VALID UNTIL 'infinity'/);assert.match(a.nextWriteStep.action,/NOLOGIN and VALID UNTIL infinity in one SQL statement/);assert.ok(a.nextWriteStep.preconditions.some(x=>/finite VALID UNTIL, expired or future, is a STALE_LEASE and not a clean baseline/.test(x)));assert.equal(a.credentialActivation.containmentRetry,'BOUNDED_UNTIL_CONFIRMED');assert.equal(a.credentialActivation.finalization,'SINK_CONFIRMED_THEN_VALID_UNTIL_INFINITY');
 assert.equal(a.credentialActivation.restart.maxCalls,1);assert.match(a.nextWriteStep.action,/VALID UNTIL lease.*restart.*sink.*infinity/);assert.equal(a.credentialActivation.passwordReset.idempotent,false);assert.match(a.nextWriteStep.action,/NOLOGIN.*reset_password.*LOGIN/);assert.equal(a.nextWriteStep.gate,'PRODUCTION_CREDENTIAL_CANARY');assert.doesNotMatch(JSON.stringify(a),/SCRAM|scram_iterations/);assert.equal(a.credentialActivation.managerRole,'neondb_role_admin');assert.equal(a.credentialActivation.canary,'content_read');assert.equal(a.credentialActivation.services.length,10);assert.equal(a.credentialActivation.branchProtection,'REQUIRED_BEFORE_FIRST_CREDENTIAL');assert.match(a.credentialActivation.planSha256,/^[a-f0-9]{64}$/);
 assert.notEqual((await productionActivationPlan({...source,head:'2'.repeat(40)})).planDigestSha256,a.planDigestSha256);
});
test('credentials are listed by name only; a secret present in the environment never reaches the plan',async()=>{
 const secret='re_THIS_VALUE_MUST_NEVER_APPEAR_0001',old=process.env.PRODUCTION_RESEND_API_KEY;process.env.PRODUCTION_RESEND_API_KEY=secret;
 try{const plan=JSON.stringify(await productionActivationPlan(source));assert.ok(!plan.includes(secret));assert.ok(plan.includes('"PRODUCTION_RESEND_API_KEY"'));}
 finally{if(old===undefined)delete process.env.PRODUCTION_RESEND_API_KEY;else process.env.PRODUCTION_RESEND_API_KEY=old;}
 const p=await productionActivationPlan(source);
 for(const name of p.credentials.webApp.secretNames)assert.ok(p.credentials.webApp.names.includes(name));
 assert.deepEqual(p.credentials.webApp.mustBeAbsentUntilPublicationGo,['PRODUCTION_PUBLICATION_APPROVAL']);
});
