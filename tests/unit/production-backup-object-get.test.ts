import test from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync,existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,statSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {objectKey} from '../../scripts/production-backup';
import {evidenceDirectory} from '../../scripts/production-backup-credential';
import {BACKUP_OBJECT_KEY,assertKeyConsistent,downloadBackupObject,main,parseObjectKey,plannedOutput,wranglerArgs} from '../../scripts/production-backup-object-get';

const hourly=objectKey('hourly',new Date('2026-10-04T16:17:00.000Z'));
const daily=objectKey('daily',new Date('2026-10-05T00:17:00.000Z'));
const withRoot=async(fn:(root:string)=>Promise<void>|void)=>{const root=mkdtempSync(join(tmpdir(),'zao-object-get-'));try{await fn(root);}finally{rmSync(root,{recursive:true,force:true});}};
const putKey=(root:string,text:string)=>{mkdirSync(evidenceDirectory(root),{recursive:true});writeFileSync(join(evidenceDirectory(root),'object-key.txt'),text);};

test('the key contract is exactly what the producer writes: hourly or daily, UTC calendar path agreeing with the timestamp, and nothing else',()=>{
 for(const k of [hourly,daily]){assert.match(k,BACKUP_OBJECT_KEY);assert.equal(parseObjectKey(k+'\n'),k);assertKeyConsistent(k);}
 for(const bad of ['','../hourly/2026/10/04/2026-10-04T16-17-00-000Z.dump.age','hourly/2026/10/04/2026-10-04T16-17-00-000Z.dump','other/2026/10/04/2026-10-04T16-17-00-000Z.dump.age',
  'hourly/2026/10/04/2026-10-04T16-17-00-000Z.dump.age --file /etc/x','hourly/2026/10/04/../../x.dump.age','hourly/2026/10/04/2026-10-04T16-17-00-000Z.dump.age\nzao-other/x','/hourly/2026/10/04/2026-10-04T16-17-00-000Z.dump.age',
  'hourly/2026/10/04/2026-10-04T16:17:00.000Z.dump.age','daily/2026/10/04/2026-10-04T16-17-00-000Z.dump.age '])
  assert.throws(()=>parseObjectKey(bad),/BACKUP_OBJECT_GET_KEY_INVALID/,JSON.stringify(bad));
 assert.throws(()=>assertKeyConsistent('hourly/2026/10/05/2026-10-04T16-17-00-000Z.dump.age'),/BACKUP_OBJECT_GET_KEY_INVALID/);
});

test('the only wrangler operation is r2 object get on the exact bucket, remote, into the git-ignored evidence directory',()=>{
 const out=plannedOutput('/work',hourly);
 assert.equal(out,`/work/.local/evidence/production-backup/${hourly.split('/').pop()}`);
 assert.deepEqual(wranglerArgs(hourly,out),['r2','object','get',`zao-rental-prod-backup/${hourly}`,'--remote','--file',out]);
 const source=readFileSync('scripts/production-backup-object-get.ts','utf8');
 for(const forbidden of ["'put'","'delete'","'bucket'","'lifecycle'","'domain'","'cors'","--local"])assert.ok(!source.includes(forbidden),forbidden);
});

test('a fake wrangler receives exactly the fixed argv; the result is a 0600 file with its size and sha256; the key file is never trusted beyond the contract',async()=>withRoot(async root=>{
 const argvFile=join(root,'argv.txt'),bin=join(root,'wrangler');
 writeFileSync(bin,`#!/bin/sh\nprintf '%s\\n' "$@" > '${argvFile}'\nprintf 'CIPHERTEXT-BYTES' > "$7"\n`);chmodSync(bin,0o755);
 putKey(root,hourly+'\n');
 const run=async(b:string,args:string[])=>{const {execFileSync}=await import('node:child_process');execFileSync(b,args);};
 const result=await downloadBackupObject(root,run,bin);
 assert.equal(result.state,'DOWNLOADED');assert.equal(result.key,hourly);assert.equal(result.bytes,16);
 assert.equal(result.ciphertextSha256,createHash('sha256').update('CIPHERTEXT-BYTES').digest('hex'));
 assert.equal(result.path,`.local/evidence/production-backup/${hourly.split('/').pop()}`);
 const out=plannedOutput(root,hourly);assert.equal(statSync(out).mode&0o777,0o600);
 assert.deepEqual(readFileSync(argvFile,'utf8').trim().split('\n'),wranglerArgs(hourly,out));
 // never overwrites an existing download
 await assert.rejects(downloadBackupObject(root,run,bin),/BACKUP_OBJECT_GET_OUTPUT_EXISTS/);
 assert.equal(readFileSync(out,'utf8'),'CIPHERTEXT-BYTES');
}));

test('failures leave nothing behind: missing key file, invalid key, missing tool, wrangler failure, empty output, symlink output',async()=>withRoot(async root=>{
 const ok=async()=>undefined;
 await assert.rejects(downloadBackupObject(root,ok,'/nonexistent/wrangler'),/BACKUP_OBJECT_GET_KEY_FILE_MISSING/);
 putKey(root,'../etc/passwd');
 await assert.rejects(downloadBackupObject(root,ok,'/bin/echo'),/BACKUP_OBJECT_GET_KEY_INVALID/);
 putKey(root,hourly);
 await assert.rejects(downloadBackupObject(root,ok,'/nonexistent/wrangler'),/BACKUP_OBJECT_GET_WRANGLER_MISSING/);
 const out=plannedOutput(root,hourly);
 const failing=async(_b:string,args:string[])=>{writeFileSync(args[6]!,'partial');throw new Error('BACKUP_OBJECT_GET_WRANGLER_FAILED');};
 await assert.rejects(downloadBackupObject(root,failing,'/bin/echo'),/BACKUP_OBJECT_GET_WRANGLER_FAILED/);assert.equal(existsSync(out),false,'a partial download is removed');
 const empty=async(_b:string,args:string[])=>{writeFileSync(args[6]!,'');};
 await assert.rejects(downloadBackupObject(root,empty,'/bin/echo'),/BACKUP_OBJECT_GET_OUTPUT_INVALID/);assert.equal(existsSync(out),false);
 const link=async(_b:string,args:string[])=>{symlinkSync('/etc/hosts',args[6]!);};
 await assert.rejects(downloadBackupObject(root,link,'/bin/echo'),/BACKUP_OBJECT_GET_OUTPUT_INVALID/);assert.equal(existsSync(out),false);
}));

test('the command takes no arguments and is the single package script',async()=>{
 await assert.rejects(main(['--key','x']),/BACKUP_OBJECT_GET_ARGUMENTS_REFUSED/);
 const pkg=JSON.parse(readFileSync('package.json','utf8')) as {scripts:Record<string,string>};
 assert.equal(pkg.scripts['backup:object-get'],'node --import tsx scripts/production-backup-object-get.ts');
});
