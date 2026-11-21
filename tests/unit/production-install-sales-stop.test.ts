import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {main,type InstallSeams} from '../../scripts/production-install-sales-stop';

// 0062 sales stop delta (migration + operations grants) operator: the same admission gates as the staff delta installer.
test('sales stop installer: unknown or extra arguments are refused before anything else',async()=>{
 for(const argv of [['migrate','--force'],['rollback'],[],['grants','x']])await assert.rejects(main(argv),/PRODUCTION_INSTALL_ARGUMENTS_REJECTED/,JSON.stringify(argv));
});
test('sales stop installer: without a verified Production restore PASS no owner session is opened',async()=>{
 const root=mkdtempSync(join(tmpdir(),'zao-sales-stop-'));let opened=0;
 const seams:InstallSeams={release:()=>'0'.repeat(40),openSession:async()=>{opened++;throw new Error('SEAM_OWNER_SESSION_REACHED');}};
 try{for(const command of ['migrate','grants'])await assert.rejects(main([command],root,seams),/PRODUCTION_INSTALL_RESTORE_PASS_REQUIRED/,command);}finally{rmSync(root,{recursive:true,force:true});}
 assert.equal(opened,0);
});
test('sales stop installer: a release check failure stops before the restore check and the session',async()=>{
 let opened=0;const seams:InstallSeams={release:()=>{throw new Error('PRODUCTION_INSTALL_RELEASE_REJECTED');},openSession:async()=>{opened++;throw new Error('x');}};
 await assert.rejects(main(['migrate'],process.cwd(),seams),/PRODUCTION_INSTALL_RELEASE_REJECTED/);assert.equal(opened,0);
});
test('sales stop package scripts are the two fixed commands and the installer prints no connection details',()=>{
 const pkg=JSON.parse(readFileSync('package.json','utf8')) as {scripts:Record<string,string>};
 assert.equal(pkg.scripts['production:install-sales-stop-migration'],'node --import tsx scripts/production-install-sales-stop.ts migrate');
 assert.equal(pkg.scripts['production:install-sales-stop-grants'],'node --import tsx scripts/production-install-sales-stop.ts grants');
 const source=readFileSync('scripts/production-install-sales-stop.ts','utf8');
 assert.ok(!/console\.(log|error)\([^)]*(uri|password|connection)/i.test(source));
 assert.ok(/applyProductionSalesStopMigration\(session\.client,'neondb','neondb_owner'\)/.test(source)&&/applyProductionSalesStopGrants\(session\.client,'neondb','neondb_owner'\)/.test(source));
});
