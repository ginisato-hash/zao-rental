import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {productionGroupDeltaGrants,ROLE_CREATE_SQL} from '../../scripts/production-group-delta';
import {main,type InstallSeams} from '../../scripts/production-install-group';

// 0064 group delta (migration + operations grants) operator: the same admission gates as the staff delta installer.
test('group installer: unknown or extra arguments are refused before anything else',async()=>{
 for(const argv of [['migrate','--force'],['rollback'],[],['grants','x'],['verify','--write']])await assert.rejects(main(argv),/PRODUCTION_INSTALL_ARGUMENTS_REJECTED/,JSON.stringify(argv));
});
test('group installer: without a verified Production restore PASS no owner session is opened',async()=>{
 const root=mkdtempSync(join(tmpdir(),'zao-group-'));let opened=0;
 const seams:InstallSeams={release:()=>'0'.repeat(40),openSession:async()=>{opened++;throw new Error('SEAM_OWNER_SESSION_REACHED');}};
 try{for(const command of ['migrate','grants'])await assert.rejects(main([command],root,seams),/PRODUCTION_INSTALL_RESTORE_PASS_REQUIRED/,command);}finally{rmSync(root,{recursive:true,force:true});}
 assert.equal(opened,0);
});
test('group verify: read-only, so no restore PASS is needed, but the accepted-main check still runs first and only then the owner session',async()=>{
 const root=mkdtempSync(join(tmpdir(),'zao-group-'));const order:string[]=[];
 const seams:InstallSeams={release:()=>{order.push('release');return '0'.repeat(40);},openSession:async()=>{order.push('session');throw new Error('SEAM_OWNER_SESSION_REACHED');}};
 try{await assert.rejects(main(['verify'],root,seams),/SEAM_OWNER_SESSION_REACHED/);}finally{rmSync(root,{recursive:true,force:true});}
 assert.deepEqual(order,['release','session']);
 let opened=0;await assert.rejects(main(['verify'],process.cwd(),{release:()=>{throw new Error('PRODUCTION_INSTALL_RELEASE_REJECTED');},openSession:async()=>{opened++;throw new Error('x');}}),/PRODUCTION_INSTALL_RELEASE_REJECTED/);assert.equal(opened,0);
});
test('group installer: a release check failure stops before the restore check and the session',async()=>{
 let opened=0;const seams:InstallSeams={release:()=>{throw new Error('PRODUCTION_INSTALL_RELEASE_REJECTED');},openSession:async()=>{opened++;throw new Error('x');}};
 await assert.rejects(main(['migrate'],process.cwd(),seams),/PRODUCTION_INSTALL_RELEASE_REJECTED/);assert.equal(opened,0);
});
test('group package scripts are the three fixed commands and the installer prints no connection details',()=>{
 const pkg=JSON.parse(readFileSync('package.json','utf8')) as {scripts:Record<string,string>};
 assert.equal(pkg.scripts['production:install-group-migration'],'node --import tsx scripts/production-install-group.ts migrate');
 assert.equal(pkg.scripts['production:install-group-grants'],'node --import tsx scripts/production-install-group.ts grants');
 assert.equal(pkg.scripts['production:verify-group'],'node --import tsx scripts/production-install-group.ts verify');
 const source=readFileSync('scripts/production-install-group.ts','utf8');
 assert.ok(!/console\.(log|error)\([^)]*(uri|password|connection)/i.test(source));
 assert.ok(/applyProductionGroupMigration\(session\.client,'neondb','neondb_owner'\)/.test(source)&&/applyProductionGroupGrants\(session\.client,'neondb','neondb_owner'\)/.test(source));
});

test('group grants: fixed statements, least privilege, nothing to PUBLIC, no DDL or role attribute change',()=>{
 const sql=productionGroupDeltaGrants('neondb');
 assert.ok(sql.includes('GRANT EXECUTE ON FUNCTION group_register_actor(uuid) TO "neondb_group"'));
 assert.ok(sql.includes('GRANT SELECT,INSERT,UPDATE,DELETE ON group_members TO "neondb_group"'));
 assert.ok(sql.includes('GRANT SELECT,INSERT ON group_part_preparations TO "neondb_operations"'));
 assert.ok(sql.includes('GRANT UPDATE(prepared_at,prepared_by,fit_evidence,version) ON group_part_preparations TO "neondb_operations"'));
 assert.ok(sql.some(s=>/^GRANT UPDATE\(status,attempt_count,next_attempt_at,claim_id,claim_until,provider_message_id,sent_at,last_safe_failure_code\) ON group_notification_outbox TO "neondb_group"$/.test(s)));
 assert.ok(sql.every(s=>/^GRANT /.test(s)&&!/PUBLIC|ALL|TRUNCATE|WITH GRANT OPTION|ADMIN/i.test(s)),'only plain GRANT statements, never PUBLIC/ALL/TRUNCATE/grant option');
 assert.ok(sql.every(s=>!/ON group_(events|quotes|consents|adjustments|payments|requests|entrance_history|notification_outbox) .*\b(UPDATE|DELETE)\b/.test(s)||/^GRANT UPDATE\(/.test(s)),'append-only tables are never updated or deleted by the group role');
 assert.ok(!sql.some(s=>/admin_message|event_type|dedupe_key/.test(s)),'what a notice is and for whom stays immutable');
 for(const bad of ['Neondb','neon-db','1db','x'.repeat(50)])assert.throws(()=>productionGroupDeltaGrants(bad),/PRODUCTION_GROUP_GRANTS_REFUSED/,bad);
});
test('group role plan: the role is NOLOGIN with no powers and is created through the role manager, never by the owner',()=>{
 assert.equal(ROLE_CREATE_SQL('neondb'),'CREATE ROLE "neondb_group" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS');
 const src=readFileSync('scripts/production-group-delta.ts','utf8');
 assert.ok(/SET LOCAL ROLE \$\{q\(r\.manager\)\}`\);await c\.query\(ROLE_CREATE_SQL\(database\)\)/.test(src));
});
test('group migrate: the fixed code for the executor-owned object blocker is an installer-safe code',()=>{
 const src=readFileSync('scripts/production-install-group.ts','utf8');
 assert.ok(/PRODUCTION_\(INSTALL\|GROUP\|/.test(src));
 assert.match('PRODUCTION_GROUP_EXECUTOR_OWNED_OBJECTS_BLOCKED',/^PRODUCTION_(INSTALL|GROUP|COUPON_ADMIN|SALES_STOP|FIRST_ADMIN|STAFF_BOOTSTRAP|CREDENTIAL)_[A-Z0-9_]{1,80}$/);
});
