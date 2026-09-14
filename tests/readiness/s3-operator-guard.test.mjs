import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {dispatchS3Once} from '../../tools/acceptance/s3-operator-guard.mjs';
const identity={operationId:'fixture-operation',manifestFingerprint:'fixture-hash',deploymentId:'fixture-preview'};
test('operator two browser request callbacks dispatch only once; fsynced record survives response loss',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'zao-s3-guard-'));const path=join(dir,'guard.json');let calls=0;
 try{
  await assert.rejects(()=>dispatchS3Once(path,identity,async()=>{calls++;assert.equal(JSON.parse(await readFile(path,'utf8')).state,'RESERVED_POSSIBLY_DISPATCHED_NO_RETRY');throw new Error('response loss');}));
  await assert.rejects(()=>dispatchS3Once(path,identity,async()=>{calls++;}),{code:'EEXIST'});assert.equal(calls,1);
 }finally{await rm(dir,{recursive:true});}
});
test('separate operator processes race for the same reservation: exactly one wins',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'zao-s3-process-'));const path=join(dir,'guard.json');
 const modulePath=resolve('tools/acceptance/s3-operator-guard.mjs');
 const code=`import {dispatchS3Once} from ${JSON.stringify(modulePath)};try{await dispatchS3Once(process.argv[1],${JSON.stringify(identity)},async()=>{});process.exitCode=0;}catch(e){process.exitCode=e.code==='EEXIST'?9:10;}`;
 const run=()=>new Promise(resolve=>{const p=spawn(process.execPath,['--input-type=module','-e',code,path],{stdio:'ignore'});p.on('exit',resolve);});
 try{assert.deepEqual((await Promise.all([run(),run()])).sort(),[0,9]);assert.equal(JSON.parse(await readFile(path,'utf8')).operationId,identity.operationId);}
 finally{await rm(dir,{recursive:true});}
});
