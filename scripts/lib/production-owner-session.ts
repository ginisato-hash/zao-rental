// Memory-only owner session for the fixed Production installers (0054/0055 and the four EXECUTE grants).
// The owner connection URI is read from the Neon API inside this process, checked against the exact endpoint host and the committed Production
// fingerprint, normalised to verify-full with channel binding, and handed to the same admission helpers the earlier first-admin and targeted
// installers use. It is never printed, written, put in argv or placed in an environment variable.
import {execFileSync} from 'node:child_process';
import {realpathSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Pool,type PoolClient} from 'pg';
import {assertFirstAdminDatabaseOwner,assertFirstAdminRelease,assertFirstAdminTls,firstAdminDatabaseConfig} from './first-admin-bootstrap';
import {BACKUP_CREDENTIAL_TARGET as T,type NeonPort} from '../production-backup-credential';
import {verifyRestorePassRecord} from '../production-restore-evidence';
import {assertProductionHost,assertProductionHostFingerprint,assertProductionPort} from '../production-backup';

const refuse=(suffix:string):never=>{throw new Error('PRODUCTION_INSTALL_'+suffix);};
const TLS_OVERRIDES=['NODE_TLS_REJECT_UNAUTHORIZED','NODE_EXTRA_CA_CERTS','SSL_CERT_FILE','SSL_CERT_DIR'] as const;

/** Exact accepted source: this checkout is the repository root, origin is the repository, the tree is clean and HEAD is the current origin/main. */
export function assertAcceptedMainRelease(root:string=resolve(dirname(fileURLToPath(import.meta.url)),'..','..')){
 const git=(...args:string[])=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:20000}).trim();
 if(realpathSync(git('rev-parse','--show-toplevel'))!==realpathSync(root))refuse('RELEASE_REJECTED');
 const head=git('rev-parse','HEAD'),remote=git('ls-remote','origin','refs/heads/main').split(/\s+/);
 assertFirstAdminRelease({origin:git('remote','get-url','origin'),head,main:remote.length===2&&remote[1]==='refs/heads/main'?remote[0]!:'',clean:git('status','--porcelain','--untracked-files=all')===''});
 return head;
}
export function assertNoTlsOverrides(env:NodeJS.ProcessEnv=process.env){
 if(TLS_OVERRIDES.some(k=>env[k]!==undefined))refuse('TLS_REJECTED');
}
/** The versioned restore PASS record is derived by `production-restore-evidence` from the Owner's restore result and the downloaded ciphertext; this gate re-verifies every binding
 * (drill result hash, object key, ciphertext, pre-0054 registry) and the freshness. A shape-only or edited file is refused. It is not a signature: see the evidence module header.
 * The refusal carries the evidence module's fixed reason code (never text from the evidence) so the operator can see why. */
export async function requireRestorePass(root:string=process.cwd()){
 try{return await verifyRestorePassRecord(root);}
 catch(e){const m=String((e as Error)?.message??'');throw Object.assign(new Error('PRODUCTION_INSTALL_RESTORE_PASS_REQUIRED'),{reason:/^RESTORE_EVIDENCE_[A-Z_]{1,40}$/.test(m)?m:null});}
}

export type OwnerSession={client:PoolClient;close():Promise<void>};
export type PoolFactory=(config:ReturnType<typeof firstAdminDatabaseConfig>)=>Pool;
/** Opens the pinned owner session through the Neon API and proves identity, owner role and verify-full TLS before returning it. */
export async function openOwnerSession(neon:NeonPort,createPool:PoolFactory=c=>new Pool(c)):Promise<OwnerSession>{
 const branch=`/projects/${T.project}/branches/${T.branch}`;
 const endpoints=(await neon.get(`${branch}/endpoints`) as {endpoints?:Array<{type?:unknown;branch_id?:unknown;host?:unknown}>}).endpoints;
 const rw=(Array.isArray(endpoints)?endpoints:[]).filter(e=>e?.type==='read_write'&&e.branch_id===T.branch);
 if(rw.length!==1||typeof rw[0]!.host!=='string')return refuse('ENDPOINT_AMBIGUOUS');
 const host=(rw[0]!.host as string).trim().toLowerCase();
 assertProductionHost(host);assertProductionPort(T.port);assertProductionHostFingerprint(host);
 const raw=(await neon.get(`/projects/${T.project}/connection_uri`,{branch_id:T.branch,database_name:T.database,role_name:T.owner,pooled:'false'}) as {uri?:unknown}).uri;
 if(typeof raw!=='string')return refuse('OWNER_SESSION_INVALID');
 let uri:URL;try{uri=new URL(raw);}catch{return refuse('OWNER_SESSION_INVALID');}
 if(uri.hostname.toLowerCase()!==host)return refuse('OWNER_SESSION_INVALID');
 uri.search='?sslmode=verify-full';
 const pool=createPool(firstAdminDatabaseConfig(uri.toString()));pool.on('error',()=>{});
 let client:PoolClient|undefined;
 try{
  client=await pool.connect();
  assertFirstAdminTls(client,host);await assertFirstAdminDatabaseOwner(client);
 }catch(error){
  try{client?.release(true);}catch{/* already gone */}
  await pool.end().catch(()=>undefined);
  throw error;
 }
 const opened=client;
 return {client:opened,async close(){try{opened.release();}finally{await pool.end().catch(()=>undefined);}}};
}
