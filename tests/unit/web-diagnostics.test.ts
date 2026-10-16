import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {staffOperationDiagnostic} from '../../apps/web/src/lib/staff-operation-diagnostic';
import {safeWebDiagnostic,webDiagnosticForwarder,safeTestTransportFailure,safeHttpResponseDiagnostic} from '../flow/web-diagnostics';
test('CI diagnostic forwarding preserves only the exact emitted safe schema and historical auth code',()=>{
 const value=staffOperationDiagnostic({code:'23514'},'WRITE'),line=JSON.stringify(value);assert.equal(safeWebDiagnostic(line),line);assert.equal(safeWebDiagnostic('AUTH_PIPELINE_CODE LOGIN_REJECTED'),'AUTH_PIPELINE_CODE LOGIN_REJECTED');
 for(const bad of [{...value,email:'synthetic@example.invalid'},{...value,phase:'SYNTHETIC_PRIVATE'},{...value,category:'SYNTHETIC_PRIVATE'},{...value,correlationId:'client-selected'},{...value,code:'OTHER'},{...value,stack:'SYNTHETIC_PRIVATE'},null,[]])assert.equal(safeWebDiagnostic(JSON.stringify(bad)),null);
 assert.equal(safeWebDiagnostic('arbitrary secret-like diagnostic'),null);
});
test('split/coalesced/oversized child stderr never drops a valid record or forwards an unsafe suffix',()=>{
 const line=JSON.stringify({code:'STAFF_OPERATION_DIAGNOSTIC',correlationId:randomUUID(),phase:'INPUT',category:'OTHER'}),out:string[]=[],f=webDiagnosticForwarder(s=>out.push(s));
 for(const ch of line+'\n')f.push(Buffer.from(ch));f.push('SYNTHETIC_PRIVATE\n'+line+'\n');f.push('x'.repeat(4096));f.push(line+'\n'+line.slice(0,30));f.push(line.slice(30));f.end();
 assert.deepEqual(out,[line,line,line]);assert.ok(!out.join().includes('SYNTHETIC_PRIVATE'));
});

test('transport failure classification never exports messages, URLs, cookies or arbitrary codes',()=>{
 for(const [message,category] of [['apiRequestContext.get: read ECONNRESET','CONNECTION_RESET'],['socket hang up','CONNECTION_RESET'],['connect ECONNREFUSED','CONNECTION_REFUSED'],['Timeout 30000ms exceeded','TIMEOUT'],['Target page, context or browser has been closed','CONTEXT_CLOSED'],['SYNTHETIC_PRIVATE','UNCLASSIFIED']]){
  const result=safeTestTransportFailure(new Error(message+' URL=http://SYNTHETIC_PRIVATE Cookie=SYNTHETIC_PRIVATE'));assert.deepEqual(result,{code:'TEST_HTTP_TRANSPORT_FAILURE',category});assert.ok(!JSON.stringify(result).includes('PRIVATE'));
 }
 assert.deepEqual(safeTestTransportFailure({get message(){throw Error('must not invoke');}}),{code:'TEST_HTTP_TRANSPORT_FAILURE',category:'UNCLASSIFIED'});
 for(const [message,category] of [['DISK_BLOCKED {"private":"SYNTHETIC_PRIVATE"}','DISK_SPACE'],['Port 23920 is occupied; refusing to attach or kill any process','LOCAL_PORT_UNAVAILABLE'],['Ambient database configuration detected; SYNTHETIC_PRIVATE','AMBIENT_DATABASE_REJECTED']]){
  assert.deepEqual(safeTestTransportFailure(new Error(message)),{code:'TEST_HTTP_TRANSPORT_FAILURE',category});
 }
});

test('Next dev server failure lines forward only a fixed category, never their text',()=>{
 for(const [line,category] of [[' ⨯ ./src/x.ts Module not found: SYNTHETIC_PRIVATE','MODULE_NOT_FOUND'],['Failed to compile SYNTHETIC_PRIVATE','COMPILE'],[' ⨯ unhandledRejection: SYNTHETIC_PRIVATE','UNHANDLED'],[' ⨯ Error: SYNTHETIC_PRIVATE connection-detail','RUNTIME'],['Module build failed: SYNTHETIC_PRIVATE','COMPILE']] as const){
  const out=safeWebDiagnostic(line);assert.equal(out,'NEXT_DEV_ERROR '+category);assert.ok(!out!.includes('PRIVATE'));}
 assert.equal(safeWebDiagnostic(' ✓ Compiled /api/staff-users in 812ms'),null);assert.equal(safeWebDiagnostic('Error: SYNTHETIC_PRIVATE'),null);
});
test('test-side response diagnostic exposes status/kind/allowlisted code/framework category only',async()=>{
 const r=(status:number,type:string,body:string)=>({status:()=>status,headers:()=>(type?{'content-type':type}:{}) as Record<string,string>,text:async()=>body});
 assert.deepEqual(await safeHttpResponseDiagnostic('STAFF_CREATE',r(500,'application/json','{"error":"STAFF_OPERATION_FAILED","detail":"SYNTHETIC_PRIVATE"}')),{code:'TEST_HTTP_RESPONSE_DIAGNOSTIC',stage:'STAFF_CREATE',status:500,contentKind:'JSON',errorCode:'STAFF_OPERATION_FAILED',framework:null});
 assert.equal((await safeHttpResponseDiagnostic('S',r(500,'application/json','{"error":"lowercase private"}'))).errorCode,null);
 assert.equal((await safeHttpResponseDiagnostic('S',r(500,'application/json','not json SYNTHETIC_PRIVATE'))).errorCode,'UNPARSEABLE_JSON');
 assert.equal((await safeHttpResponseDiagnostic('S',r(500,'text/html; charset=utf-8','<p>Failed to compile</p>SYNTHETIC_PRIVATE'))).framework,'FRAMEWORK_COMPILE_ERROR');
 assert.equal((await safeHttpResponseDiagnostic('S',r(500,'text/html','<script id="__next_error__">SYNTHETIC_PRIVATE'))).framework,'FRAMEWORK_RUNTIME_ERROR');
 const html=await safeHttpResponseDiagnostic('S',r(500,'text/html','<h1>SYNTHETIC_PRIVATE</h1>'));assert.equal(html.framework,'HTML_OTHER');assert.ok(!JSON.stringify(html).includes('PRIVATE'));
 assert.equal((await safeHttpResponseDiagnostic('S',r(502,'',''))).contentKind,'NONE');
});
