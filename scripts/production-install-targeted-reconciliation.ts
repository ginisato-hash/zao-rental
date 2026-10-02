import {execFileSync} from 'node:child_process';
import {realpathSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Pool} from 'pg';
import {assertFirstAdminDatabaseOwner,assertFirstAdminRelease,assertFirstAdminTls,firstAdminDatabaseConfig,firstAdminSafeError} from './lib/first-admin-bootstrap';
import {applyProductionTargetedReconciliationMigration,productionTargetedMigrationSafeError} from './production-targeted-reconciliation-migration';
async function main(){
 const raw=process.env.PRODUCTION_PAYMENT_MIGRATION_DATABASE_URL;delete process.env.PRODUCTION_PAYMENT_MIGRATION_DATABASE_URL;
 if(process.argv.length!==2)throw Error('PRODUCTION_STAFF_BOOTSTRAP_ARGUMENTS_REJECTED');
 const git=(...args:string[])=>execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:20000}).trim();
 if(realpathSync(git('rev-parse','--show-toplevel'))!==realpathSync(resolve(dirname(fileURLToPath(import.meta.url)),'..')))throw Error('PRODUCTION_STAFF_BOOTSTRAP_RELEASE_REJECTED');
 const head=git('rev-parse','HEAD'),remote=git('ls-remote','origin','refs/heads/main').split(/\s+/);
 assertFirstAdminRelease({origin:git('remote','get-url','origin'),head,main:remote.length===2&&remote[1]==='refs/heads/main'?remote[0]!:'',clean:git('status','--porcelain','--untracked-files=all')===''});
 if(['NODE_TLS_REJECT_UNAUTHORIZED','NODE_EXTRA_CA_CERTS','SSL_CERT_FILE','SSL_CERT_DIR'].some(k=>process.env[k]!==undefined))throw Error('PRODUCTION_STAFF_BOOTSTRAP_TLS_REJECTED');
 const config=firstAdminDatabaseConfig(raw),pool=new Pool(config);pool.on('error',()=>{});
 try{const c=await pool.connect();try{assertFirstAdminTls(c,config.host);await assertFirstAdminDatabaseOwner(c);console.log(JSON.stringify({sourceSha:head,...await applyProductionTargetedReconciliationMigration(c,'neondb','neondb_owner')}));}finally{c.release();}}finally{await pool.end();}
}
main().catch(error=>{const admission=firstAdminSafeError(error);console.error(JSON.stringify({status:'STOP',code:admission==='PRODUCTION_STAFF_BOOTSTRAP_OPERATION_FAILED'?productionTargetedMigrationSafeError(error):admission}));process.exitCode=1;});
