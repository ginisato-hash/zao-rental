import {execFileSync} from 'node:child_process';
import {realpathSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Pool} from 'pg';
import {assertFirstAdminDatabaseOwner,assertFirstAdminRelease,assertFirstAdminTls,firstAdminDatabaseConfig,firstAdminSafeError,firstAdminTransaction,readFirstAdminInput} from './lib/first-admin-bootstrap';

// Explicit attended CLI only; never imported by the application. The DB credential is
// injected into this process from an approved secure source, not a CLI value or .env load.
async function main(){
 const databaseUrl=process.env.PRODUCTION_STAFF_BOOTSTRAP_DATABASE_URL;
 delete process.env.PRODUCTION_STAFF_BOOTSTRAP_DATABASE_URL;
 const [flag,path,...extra]=process.argv.slice(2);
 if(flag!=='--input'||!path||extra.length)throw Error('PRODUCTION_STAFF_BOOTSTRAP_ARGUMENTS_REJECTED');
 const git=(...args:string[])=>execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:20000}).trim();
 const repository=realpathSync(git('rev-parse','--show-toplevel'));
 if(repository!==realpathSync(resolve(dirname(fileURLToPath(import.meta.url)),'..')))throw Error('PRODUCTION_STAFF_BOOTSTRAP_RELEASE_REJECTED');
 // An Owner file in another checkout is also not outside repositories.
 try{if(git('-C',dirname(realpathSync(path)),'rev-parse','--is-inside-work-tree')==='true')throw Error('PRODUCTION_STAFF_BOOTSTRAP_SECURE_INPUT_REQUIRED');}
 catch(error){if(error instanceof Error&&error.message==='PRODUCTION_STAFF_BOOTSTRAP_SECURE_INPUT_REQUIRED')throw error;}
 const input=readFirstAdminInput(path,repository);
 const remote=git('ls-remote','origin','refs/heads/main').split(/\s+/),head=git('rev-parse','HEAD');
 assertFirstAdminRelease({origin:git('remote','get-url','origin'),head,main:remote.length===2&&remote[1]==='refs/heads/main'?remote[0]!:'',clean:git('status','--porcelain','--untracked-files=all')===''});
 if(['NODE_TLS_REJECT_UNAUTHORIZED','NODE_EXTRA_CA_CERTS','SSL_CERT_FILE','SSL_CERT_DIR'].some(k=>process.env[k]!==undefined))throw Error('PRODUCTION_STAFF_BOOTSTRAP_TLS_REJECTED');
 const config=firstAdminDatabaseConfig(databaseUrl),pool=new Pool(config);pool.on('error',()=>{});
 try{
  const client=await pool.connect();
  try{
   assertFirstAdminTls(client,config.host);await assertFirstAdminDatabaseOwner(client);
   const result=await firstAdminTransaction(client,input);
   console.log(JSON.stringify({status:'PRODUCTION_FIRST_ADMIN_CREATED',sourceSha:head,...result}));
  }finally{client.release();}
 }finally{await pool.end();}
}
main().catch(error=>{console.error(JSON.stringify({status:'STOP',code:firstAdminSafeError(error)}));process.exitCode=1;});
