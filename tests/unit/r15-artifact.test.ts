import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import ts from 'typescript';
// Build a deploy artifact, then execute emitted JS with ordinary Node (no tsx/TS loader).
test('R15 deployed ESM entrypoints load explicit bundled runtime under plain Node',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'zao-r15-artifact-'));
 try{
  // The build script is trusted setup code, not a runtime/provider adapter.
  const {buildIngress}=await import('../../scripts/build-ingress.mjs');
  const manifest=await buildIngress(path.join(dir,'runtime.cjs'));assert.ok(manifest.bytes>0);
  assert.equal(manifest.inputs.some((p:string)=>p.includes('payment-projection')||p.includes('payment-reconciliation')),false);
  await mkdir(path.join(dir,'api/webhooks'),{recursive:true});await writeFile(path.join(dir,'package.json'),JSON.stringify({type:'module'}));
  for(const entry of ['health','webhooks/square']){
   const source=await readFile('apps/webhook-ingress/api/'+entry+'.ts','utf8');
   const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
   await writeFile(path.join(dir,'api',entry+'.js'),output);
  }
  const code=`import assert from 'node:assert/strict';import health from './api/health.js';import webhook from './api/webhooks/square.js';
   const h=await health.fetch(new Request('https://fixture.invalid/health'));assert.equal(h.status,200);
   assert.equal((await h.json()).classification,'SANDBOX_WEBHOOK_INGRESS_ONLY');
   const w=await webhook.fetch(new Request('https://fixture.invalid/api/webhooks/square',{method:'POST',body:'{}'}));
   assert.equal(w.status,503);assert.equal((await w.json()).classification,'WEBHOOK_NOT_CONFIGURED');
   assert.equal((await health.fetch(new Request('https://fixture.invalid/api/health'))).status,404);
   console.log('ARTIFACT_NODE_PASS');`;
  const p=spawnSync(process.execPath,['--input-type=module','-e',code],{cwd:dir,encoding:'utf8',timeout:20000,env:{PATH:process.env.PATH,NODE_ENV:'production'}});
  assert.equal(p.status,0,p.stderr);assert.equal(p.stdout.trim(),'ARTIFACT_NODE_PASS');
 }finally{await rm(dir,{recursive:true,force:true});}
});
