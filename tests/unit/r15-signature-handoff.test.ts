import test from 'node:test';
import assert from 'node:assert/strict';
import {handoffR15Signature,signatureKeySink,vercelSignatureKeySink} from '../../tools/acceptance/r15-signature-handoff';
const key='SYNTHETIC_SIGNATURE_KEY_TEST_ONLY';
function response(){return {subscription:{id:'synthetic_subscription',enabled:true,api_version:'2026-08-19',notification_url:'https://zao-rental-webhook-sandbox.vercel.app/api/webhooks/square',event_types:['payment.created','payment.updated'],signature_key:key}};}
test('R15 key flows in stdin only to exact ingress Sensitive target; reflected response never escapes',async()=>{
 let calls=0;
 const result=await handoffR15Signature(response(),signatureKeySink(async(args,stdin)=>{calls++;assert.ok(args.every(s=>!s.includes(key)));assert.ok(args.includes('/v10/projects/prj_whzxwR1vj0CBBnm1UD6dz5ALPMbA/env?teamId=team_PVka5z4T6OMKBmUcqrK09yJz'));
  const b=JSON.parse(stdin);assert.deepEqual(b,{key:'SQUARE_SANDBOX_WEBHOOK_SIGNATURE_KEY',value:key,type:'sensitive',target:['production']});
  return JSON.stringify({created:{...b,id:'synthetic_env',decrypted:true}});
 }));assert.equal(calls,1);assert.equal(result.state,'PERSISTED_AWAITING_METADATA_READBACK');assert.ok(!JSON.stringify(result).includes(key));
});
for(const mode of ['throw','invalid-json','api-error','wrong-target','missing-receipt'] as const)test('R15 '+mode+' cannot expose reflected key and is not retried',async()=>{
 let calls=0;const sink=signatureKeySink(async()=>{calls++;if(mode==='throw')throw Error(key);
  if(mode==='invalid-json')return key;
  if(mode==='api-error')return JSON.stringify({error:{message:key}});
  if(mode==='missing-receipt')return JSON.stringify({value:key});
  return JSON.stringify({created:{key:'SQUARE_SANDBOX_WEBHOOK_SIGNATURE_KEY',type:'sensitive',target:['preview'],id:key}});
 });await assert.rejects(handoffR15Signature(response(),sink),e=>e instanceof Error&&e.message==='R15_SIGNATURE_HANDOFF_STOP_RECONCILE_NO_RETRY'&&!String(e.stack).includes(key)&&!('cause' in e));assert.equal(calls,1);
});
test('R15 subscription context mismatch fails before secret persistence',async()=>{
 for(const change of [{enabled:false},{notification_url:'https://example.invalid'},{api_version:'wrong'},{event_types:['refund.updated']},{signature_key:''}]){
  let calls=0;await assert.rejects(handoffR15Signature({subscription:{...response().subscription,...change}},{async persist(){calls++;}}),/R15_SIGNATURE_HANDOFF_STOP/);assert.equal(calls,0);
 }
});

test('R15 concrete CLI pipe discards stdout/stderr secrets on success and failure',async()=>{
 const {mkdtemp,writeFile,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const dir=await mkdtemp(join(tmpdir(),'zao-r15-handoff-test-'));
 try{for(const fail of [false,true]){
  const path=join(dir,'fake-cli.cjs');
  await writeFile(path,`let text='';process.stdin.on('data',x=>text+=x);process.stdin.on('end',()=>{const b=JSON.parse(text);if(process.argv.join(' ').includes(b.value))process.exit(31);if(${fail}){process.stderr.write(b.value);process.stdout.write(b.value);process.exit(1);}process.stdout.write(JSON.stringify({created:{...b,id:'synthetic_env'}}));});`);
  const call=()=>handoffR15Signature(response(),vercelSignatureKeySink(path,dir));
  if(fail)await assert.rejects(call(),e=>e instanceof Error&&!String(e.stack).includes(key)&&e.message==='R15_SIGNATURE_HANDOFF_STOP_RECONCILE_NO_RETRY');
  else assert.ok(!JSON.stringify(await call()).includes(key));
 }}finally{await rm(dir,{recursive:true,force:true});}
});
