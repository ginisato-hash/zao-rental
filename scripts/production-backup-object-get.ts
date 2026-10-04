// Read-only R2 download of the ONE encrypted object a Production Backup run produced. This pinned wrapper is the only command the Owner policy
// allows for `wrangler r2 object get` (the raw command, with its wildcards, is not allowed): no arguments; the key comes from the fixed file
// `.local/evidence/production-backup/object-key.txt`, is validated against the producer's exact key contract, and the output is always
// `.local/evidence/production-backup/<basename>` (git-ignored, never overwritten). The bucket is the one pinned production bucket; the only
// wrangler operation is `r2 object get --remote --file`; there is no put, delete, bucket, lifecycle or public-access command anywhere in this file.
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chmodSync,createReadStream,existsSync,lstatSync,mkdirSync,readFileSync,rmSync} from 'node:fs';
import {homedir} from 'node:os';
import {basename,join} from 'node:path';
import {EXPECTED_PRODUCTION_BUCKET} from './production-backup';
import {evidenceDirectory} from './production-backup-credential';

/** Same contract as `objectKey()` in production-backup.ts and the restore drill: hourly/ or daily/, UTC date, millisecond timestamp, `.dump.age`. */
export const BACKUP_OBJECT_KEY=/^(hourly|daily)\/\d{4}\/\d{2}\/\d{2}\/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.dump\.age$/;
const WRANGLER_BIN=join(homedir(),'.npm/_npx/32026684e21afda6/node_modules/.bin/wrangler');
const fail=(code:string)=>new Error('BACKUP_OBJECT_GET_'+code);

export function parseObjectKey(text:string):string{
 const key=text.replace(/\r?\n$/,'');
 if(key.length>200||/[\r\n\s]/.test(key)||!BACKUP_OBJECT_KEY.test(key))throw fail('KEY_INVALID');
 return key;
}
/** The key's calendar path must agree with its timestamp (a mismatched key is not something the producer can have written). */
export function assertKeyConsistent(key:string){
 const m=/^(?:hourly|daily)\/(\d{4})\/(\d{2})\/(\d{2})\/(\d{4})-(\d{2})-(\d{2})T/.exec(key);
 if(!m||m[1]!==m[4]||m[2]!==m[5]||m[3]!==m[6])throw fail('KEY_INVALID');
}
export function plannedOutput(root:string,key:string){
 assertKeyConsistent(key);
 return join(evidenceDirectory(root),basename(key));
}
/** The exact, fixed argv of the only wrangler operation this wrapper runs. */
export function wranglerArgs(key:string,out:string){
 return ['r2','object','get',`${EXPECTED_PRODUCTION_BUCKET}/${key}`,'--remote','--file',out];
}
export type Run=(bin:string,args:string[])=>Promise<void>;
const toolEnv={PATH:process.env.PATH??'',HOME:process.env.HOME??''} as unknown as NodeJS.ProcessEnv;
const defaultRun:Run=(bin,args)=>new Promise<void>((resolve,reject)=>{
 execFile(bin,args,{timeout:900_000,maxBuffer:1<<20,windowsHide:true,env:toolEnv},error=>{if(error)reject(fail('WRANGLER_FAILED'));else resolve();});
});
const exists=(path:string)=>{try{lstatSync(path);return true;}catch{return false;}};
const sha256File=(path:string)=>new Promise<string>((resolve,reject)=>{const h=createHash('sha256');const s=createReadStream(path);s.on('data',d=>h.update(d));s.on('error',()=>reject(fail('READ_FAILED')));s.on('end',()=>resolve(h.digest('hex')));});

export async function downloadBackupObject(root:string=process.cwd(),run:Run=defaultRun,bin:string=WRANGLER_BIN){
 const dir=evidenceDirectory(root),keyFile=join(dir,'object-key.txt');
 if(!existsSync(keyFile))throw fail('KEY_FILE_MISSING');
 const key=parseObjectKey(readFileSync(keyFile,'utf8'));
 const out=plannedOutput(root,key);
 if(exists(out))throw fail('OUTPUT_EXISTS');
 if(!existsSync(bin))throw fail('WRANGLER_MISSING');
 mkdirSync(dir,{recursive:true,mode:0o700});
 try{
  await run(bin,wranglerArgs(key,out));
  const stat=lstatSync(out);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size<1)throw fail('OUTPUT_INVALID');
  chmodSync(out,0o600);
  return {version:'production-backup-object-get/1' as const,state:'DOWNLOADED' as const,key,bytes:stat.size,ciphertextSha256:await sha256File(out),path:`.local/evidence/production-backup/${basename(key)}`};
 }catch(error){
  rmSync(out,{force:true});
  throw error;
 }
}

export async function main(argv:string[],root:string=process.cwd()){
 if(argv.length)throw fail('ARGUMENTS_REFUSED');
 console.log(JSON.stringify(await downloadBackupObject(root)));
}
if(process.argv[1]&&new URL(import.meta.url).pathname===process.argv[1]){
 main(process.argv.slice(2)).catch(error=>{
  const m=String((error as Error)?.message??'');
  console.error(JSON.stringify({state:'FAILED',code:/^BACKUP_OBJECT_GET_[A-Z_]{1,40}$/.test(m)?m:'BACKUP_OBJECT_GET_FAILED'}));
  process.exitCode=1;
 });
}
