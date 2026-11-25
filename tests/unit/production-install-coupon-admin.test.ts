import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {productionCouponAdminGrants} from '../../scripts/production-coupon-admin-delta';
import {main,type InstallSeams} from '../../scripts/production-install-coupon-admin';

// 0063 coupon admin delta (migration + operations grants) operator: the same admission gates as the staff delta installer.
test('coupon admin installer: unknown or extra arguments are refused before anything else',async()=>{
 for(const argv of [['migrate','--force'],['rollback'],[],['grants','x'],['verify','--write']])await assert.rejects(main(argv),/PRODUCTION_INSTALL_ARGUMENTS_REJECTED/,JSON.stringify(argv));
});
test('coupon admin installer: without a verified Production restore PASS no owner session is opened',async()=>{
 const root=mkdtempSync(join(tmpdir(),'zao-coupon-admin-'));let opened=0;
 const seams:InstallSeams={release:()=>'0'.repeat(40),openSession:async()=>{opened++;throw new Error('SEAM_OWNER_SESSION_REACHED');}};
 try{for(const command of ['migrate','grants'])await assert.rejects(main([command],root,seams),/PRODUCTION_INSTALL_RESTORE_PASS_REQUIRED/,command);}finally{rmSync(root,{recursive:true,force:true});}
 assert.equal(opened,0);
});
test('coupon admin verify: read-only, so no restore PASS is needed, but the accepted-main check still runs first and only then the owner session',async()=>{
 const root=mkdtempSync(join(tmpdir(),'zao-coupon-admin-'));const order:string[]=[];
 const seams:InstallSeams={release:()=>{order.push('release');return '0'.repeat(40);},openSession:async()=>{order.push('session');throw new Error('SEAM_OWNER_SESSION_REACHED');}};
 try{await assert.rejects(main(['verify'],root,seams),/SEAM_OWNER_SESSION_REACHED/);}finally{rmSync(root,{recursive:true,force:true});}
 assert.deepEqual(order,['release','session']);
 let opened=0;await assert.rejects(main(['verify'],process.cwd(),{release:()=>{throw new Error('PRODUCTION_INSTALL_RELEASE_REJECTED');},openSession:async()=>{opened++;throw new Error('x');}}),/PRODUCTION_INSTALL_RELEASE_REJECTED/);assert.equal(opened,0);
});
test('coupon admin installer: a release check failure stops before the restore check and the session',async()=>{
 let opened=0;const seams:InstallSeams={release:()=>{throw new Error('PRODUCTION_INSTALL_RELEASE_REJECTED');},openSession:async()=>{opened++;throw new Error('x');}};
 await assert.rejects(main(['migrate'],process.cwd(),seams),/PRODUCTION_INSTALL_RELEASE_REJECTED/);assert.equal(opened,0);
});
test('coupon admin package scripts are the three fixed commands and the installer prints no connection details',()=>{
 const pkg=JSON.parse(readFileSync('package.json','utf8')) as {scripts:Record<string,string>};
 assert.equal(pkg.scripts['production:install-coupon-admin-migration'],'node --import tsx scripts/production-install-coupon-admin.ts migrate');
 assert.equal(pkg.scripts['production:install-coupon-admin-grants'],'node --import tsx scripts/production-install-coupon-admin.ts grants');
 assert.equal(pkg.scripts['production:verify-coupon-admin'],'node --import tsx scripts/production-install-coupon-admin.ts verify');
 const source=readFileSync('scripts/production-install-coupon-admin.ts','utf8');
 assert.ok(!/console\.(log|error)\([^)]*(uri|password|connection)/i.test(source));
 assert.ok(/applyProductionCouponAdminMigration\(session\.client,'neondb','neondb_owner'\)/.test(source)&&/applyProductionCouponAdminGrants\(session\.client,'neondb','neondb_owner'\)/.test(source));
});

test('coupon admin grants also repair the operations role read of the recommendation tables (custody GET 42501)',()=>{
 const sql=productionCouponAdminGrants('neondb','neondb_pricing','neondb_operations');
 assert.ok(sql.includes('GRANT SELECT ON recommendation_previews,recommendation_selections TO neondb_operations'));
 assert.ok(sql.every(s=>!/\b(UPDATE|DELETE|TRUNCATE|ALL)\b/.test(s)));
});
