import {createClusterOwner,diskPreflight} from './test-hygiene';
import {createHash} from 'node:crypto';
import {cp,mkdir,mkdtemp,readdir,lstat,readFile,access,realpath} from 'node:fs/promises';
import {resolve,relative,join} from 'node:path';
import {Pool} from 'pg';
import EmbeddedPostgres from 'embedded-postgres';
import {canonical} from '../packages/contracts/src/hold';
import {assertPortFree,rejectAmbientDatabase,worktreeIdentity} from './worktree';
import type {startIsolatedPostgres} from './postgres';
import {trackPoolLifecycle} from './pool-lifecycle';
const digest=(s:string|Buffer)=>createHash('sha256').update(s).digest('hex');
type FileProof={path:string;sha256:string;bytes:number};
async function files(dir:string):Promise<FileProof[]>{const result:FileProof[]=[];async function walk(path:string){for(const name of (await readdir(path)).sort()){const p=join(path,name),s=await lstat(p);if(s.isSymbolicLink()||!s.isFile()&&!s.isDirectory())throw new Error('BACKUP_SPECIAL_FILE_REJECTED');if(s.isDirectory())await walk(p);else result.push({path:relative(dir,p),bytes:s.size,sha256:digest(await readFile(p))});}}await walk(dir);return result;}
async function noPid(dir:string){try{await access(join(dir,'postmaster.pid'));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return;throw e;}throw new Error('BACKUP_CLUSTER_NOT_STOPPED');}
/** Test/development cold-cluster drill only. Cannot attach to ambient/production DB.
 * Stop the owned cluster first. No hot filesystem copy, no host services or pg_dump tools. */
export async function backupOwnedCluster(db:Awaited<ReturnType<typeof startIsolatedPostgres>>,onStopped:()=>void){
 rejectAmbientDatabase();const identity=worktreeIdentity(),source=await realpath(db.databaseDir),parent=await realpath(resolve('.local/postgres'));
 if(db.identity.namespace!==identity.namespace||!source.startsWith(parent+'/run-'))throw new Error('BACKUP_NOT_OWNED');
 const actual=(await db.pool.query('SHOW data_directory')).rows[0].data_directory;if(await realpath(actual)!==source)throw new Error('BACKUP_NOT_OWNED');
 const auth={user:db.pool.options.user!,password:String(db.pool.options.password),database:db.pool.options.database!};
 const stoppedAt=new Date();await db.stop();onStopped();await noPid(source);
 diskPreflight(identity.root);const backupRoot=resolve('.local/backup-drill');await mkdir(backupRoot,{recursive:true,mode:0o700});const container=await mkdtemp(backupRoot+'/backup-'),ownership=createClusterOwner(container,identity.namespace,'BACKUP'),directory=container+'/cluster';
 const manifest=await files(source);await cp(source,directory,{recursive:true,errorOnExist:true,force:false});const copied=await files(directory);if(canonical(copied)!==canonical(manifest))throw new Error('BACKUP_VERIFY_FAILED');ownership.update('STOPPED');
 return {directory,manifest,sha256:digest(canonical(manifest)),source,stoppedAt,identity,auth};
}
export async function restoreOwnedCluster(backup:Awaited<ReturnType<typeof backupOwnedCluster>>){
 rejectAmbientDatabase();const identity=worktreeIdentity(),directory=await realpath(backup.directory),root=await realpath(resolve('.local/backup-drill'));
 if(identity.namespace!==backup.identity.namespace||!directory.startsWith(root+'/backup-')||backup.auth.database!==identity.database||backup.auth.user!==identity.user)throw new Error('RESTORE_NOT_OWNED');
 await noPid(directory);if(digest(canonical(backup.manifest))!==backup.sha256||canonical(await files(directory))!==canonical(backup.manifest))throw new Error('RESTORE_DIGEST_MISMATCH');
 diskPreflight(identity.root);await assertPortFree(identity.dbPort);const container=await mkdtemp(resolve('.local/postgres')+'/restored-'),ownership=createClusterOwner(container,identity.namespace,'RESTORE'),restored=container+'/cluster';await cp(directory,restored,{recursive:true,errorOnExist:true,force:false});
 if(canonical(await files(restored))!==canonical(backup.manifest))throw new Error('RESTORE_COPY_FAILED');
 // Start the copied initialized cluster with its original credential; no rotation.
 const cluster=new EmbeddedPostgres({databaseDir:restored,user:identity.user,password:backup.auth.password,port:identity.dbPort,persistent:true,createPostgresUser:false,postgresFlags:['-h','127.0.0.1','-c','unix_socket_directories=','-c','log_statement=none'],onLog:()=>{},onError:()=>{}});
 let pool:Pool|undefined;try{await cluster.start();ownership.update('RUNNING');pool=new Pool({host:'127.0.0.1',port:identity.dbPort,...backup.auth});const close=trackPoolLifecycle(pool);await pool.query('SELECT 1');return {pool,directory:restored,async stop(){try{await close();}finally{await cluster.stop();ownership.update('STOPPED');}}};}catch(e){await pool?.end();await cluster.stop();ownership.update('FAILED');throw e;}
}
