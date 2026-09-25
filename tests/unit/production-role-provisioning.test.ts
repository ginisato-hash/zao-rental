import test from 'node:test';
import assert from 'node:assert/strict';
import {productionRoleProvisioningPlan,authorityTaggedGrants,PRODUCTION_ROLE_PROVISIONING_VERSION} from '../../scripts/production-role-provisioning';
import {productionAppRoleGrantPlan,productionAppRoleGrantSql,productionAppRoleCreateSql} from '../../scripts/production-app-roles';
import {productionBackupRoleSql,productionBackupRoleCreateSql,productionBackupRoleGrantSql} from '../../scripts/production-backup-role';
import {productionPaymentRoleCreateSql,productionPaymentActivationGrants} from '../../scripts/production-payment-roles';
import {productionFoundationPlan,bootstrapPlan} from '../../scripts/production-bootstrap';

const CUSTODY_FUNCTIONS=['rental_apply_receipt(uuid)','rental_apply_inspection(uuid)','rental_complete_no_pickup(uuid)','ops_checkout_amendment(uuid)','ops_reconcile_poles(uuid,uuid,integer)'];

test('role provisioning plan: exact 17 roles from the existing generators, a NOLOGIN manager, deterministic digest',()=>{
 const p=productionRoleProvisioningPlan('neondb');
 assert.equal(p.version,PRODUCTION_ROLE_PROVISIONING_VERSION);assert.equal(p.version,'production-role-provisioning/1');
 assert.equal(p.managerRole,'neondb_role_admin');
 assert.deepEqual(p.operationalRoleNames,['neondb_backup','neondb_pay_receipt','neondb_pay_dispatch','neondb_pay_truth','neondb_pay_projection','neondb_pay_diagnostic',
  'neondb_auth','neondb_ledger','neondb_hold','neondb_transfer','neondb_pricing','neondb_recommendation','neondb_operations','neondb_guest','neondb_content_read','neondb_avatar_read','neondb_booking_access']);
 assert.deepEqual(p.operationalCreateSql,[...productionBackupRoleCreateSql('neondb'),...productionPaymentRoleCreateSql('neondb'),...productionAppRoleCreateSql('neondb')]);
 assert.equal(p.managerCreateSql,'CREATE ROLE "neondb_role_admin" NOLOGIN NOSUPERUSER NOCREATEDB CREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS');
 assert.deepEqual(p.ownerManagerMembershipSql,['GRANT "neondb_role_admin" TO SESSION_USER WITH SET TRUE, INHERIT FALSE']);
 assert.equal(productionRoleProvisioningPlan('neondb').planSha256,p.planSha256);assert.match(p.planSha256,/^[a-f0-9]{64}$/);
 assert.notEqual(productionRoleProvisioningPlan('zao_rental_other').planSha256,p.planSha256);
 for(const s of [p.managerCreateSql,...p.operationalCreateSql,...p.ownerGrantStatements,...p.custodyExecutorGrantStatements])
  assert.doesNotMatch(s,/PASSWORD|\bLOGIN\b(?<!NOLOGIN)|ENCRYPTED/,s);
 for(const s of [p.managerCreateSql,...p.operationalCreateSql])assert.match(s,/ NOLOGIN /);
 assert.throws(()=>productionRoleProvisioningPlan('zr_0123456789ab'),/PRODUCTION_DATABASE_NAME_INVALID/);
});
test('custody authority is exactly one statement for exactly the five custody-owned functions',()=>{
 const p=productionRoleProvisioningPlan('neondb');
 assert.deepEqual(p.custodyExecutorGrantStatements,[`GRANT EXECUTE ON FUNCTION ${CUSTODY_FUNCTIONS.join(',')} TO neondb_operations`]);
 assert.ok(p.ownerGrantStatements.includes('GRANT EXECUTE ON FUNCTION inventory_clock(),inventory_record_replan(jsonb,jsonb),ops_assert_actor(text,text[],text) TO neondb_operations'));
 for(const s of p.ownerGrantStatements)for(const f of CUSTODY_FUNCTIONS)assert.ok(!s.includes(f.split('(')[0]+'('),s);
 assert.deepEqual(p.ownerGrantStatements,[...productionBackupRoleGrantSql('neondb'),...productionPaymentActivationGrants('neondb'),...productionAppRoleGrantPlan('neondb').filter(x=>x.authority==='OWNER').map(x=>x.sql)]);
 assert.deepEqual(authorityTaggedGrants(p).map(x=>x.authority),[...p.ownerGrantStatements.map(()=>'OWNER'),'CUSTODY_EXECUTOR']);
});
test('compatibility APIs keep their meaning: backup concat and app grant list',()=>{
 assert.deepEqual(productionBackupRoleSql('neondb'),[
  'CREATE ROLE neondb_backup NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS',
  'GRANT CONNECT ON DATABASE neondb TO neondb_backup','GRANT pg_read_all_data TO neondb_backup']);
 assert.deepEqual(productionBackupRoleSql('neondb'),[...productionBackupRoleCreateSql('neondb'),...productionBackupRoleGrantSql('neondb')]);
 assert.deepEqual(productionAppRoleGrantSql('neondb'),productionAppRoleGrantPlan('neondb').map(x=>x.sql));
 assert.deepEqual(productionAppRoleGrantPlan('neondb').filter(x=>x.authority==='CUSTODY_EXECUTOR').length,1);
});
test('foundation plan binds the unchanged schema plan and the role provisioning plan under one digest',async()=>{
 const f=await productionFoundationPlan('neondb'),b=await bootstrapPlan('neondb');
 assert.equal(f.bootstrap.planSha256,b.planSha256);assert.equal(f.binding.bootstrapPlanSha256,b.planSha256);
 assert.equal(f.binding.roleProvisioningVersion,'production-role-provisioning/1');assert.equal(f.binding.roleProvisioningPlanSha256,f.roles.planSha256);
 assert.match(f.foundationPlanSha256,/^[a-f0-9]{64}$/);assert.equal((await productionFoundationPlan('neondb')).foundationPlanSha256,f.foundationPlanSha256);
 assert.notEqual(f.foundationPlanSha256,b.planSha256);
 assert.deepEqual(Object.keys(f.binding).sort(),['authorityTaggedGrantsSha256','bootstrapPlanSha256','proofContractSha256','roleProvisioningPlanSha256','roleProvisioningVersion']);
});
