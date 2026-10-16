import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {staffOperationDiagnostic} from '../../apps/web/src/lib/staff-operation-diagnostic';
import {safeWebDiagnostic,webDiagnosticForwarder,safeTestTransportFailure,safeHttpResponseDiagnostic,requestErrorRecord} from '../flow/web-diagnostics';
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
 assert.equal((await safeHttpResponseDiagnostic('STAFF_CREATE',r(500,'application/json','{"error":"lowercase private"}'))).errorCode,'UNLISTED');
 // D1: a well-formed but unlisted UPPER_CASE value is never echoed.
 for(const code of ['SYNTHETIC_PRIVATE','ABCDEFGH','STAFF_OPERATION_FAILED_X']){const d=await safeHttpResponseDiagnostic('STAFF_CREATE',r(500,'application/json',JSON.stringify({error:code})));assert.equal(d.errorCode,'UNLISTED');assert.ok(!JSON.stringify(d).includes(code));}
 assert.equal((await safeHttpResponseDiagnostic('STAFF_CREATE',r(500,'application/json','{"detail":"SYNTHETIC_PRIVATE"}'))).errorCode,'NO_ERROR_FIELD');
 assert.equal((await safeHttpResponseDiagnostic('STAFF_CREATE',{status:()=>500,headers:()=>({'content-type':'text/html'}),text:async()=>{throw new Error('SYNTHETIC_PRIVATE');}})).errorCode,'UNREADABLE');
 await assert.rejects(safeHttpResponseDiagnostic('SYNTHETIC_PRIVATE' as 'STAFF_CREATE',r(500,'','')),/DIAGNOSTIC_STAGE_REJECTED/);
 assert.equal((await safeHttpResponseDiagnostic('STAFF_CREATE',r(500,'application/json','not json SYNTHETIC_PRIVATE'))).errorCode,'UNPARSEABLE_JSON');
 assert.equal((await safeHttpResponseDiagnostic('STAFF_CREATE',r(500,'text/html; charset=utf-8','<p>Failed to compile</p>SYNTHETIC_PRIVATE'))).framework,'FRAMEWORK_COMPILE_ERROR');
 assert.equal((await safeHttpResponseDiagnostic('STAFF_CREATE',r(500,'text/html','<script id="__next_error__">SYNTHETIC_PRIVATE'))).framework,'FRAMEWORK_RUNTIME_ERROR');
 const html=await safeHttpResponseDiagnostic('STAFF_CREATE',r(500,'text/html','<h1>SYNTHETIC_PRIVATE</h1>'));assert.equal(html.framework,'HTML_OTHER');assert.ok(!JSON.stringify(html).includes('PRIVATE'));
 assert.equal((await safeHttpResponseDiagnostic('STAFF_CREATE',r(502,'',''))).contentKind,'NONE');
});

test('D2: a diagnostic line survives every UTF-8 byte split and ANSI colouring; oversized lines are still dropped whole',()=>{
 const line=' ⨯ Error: SYNTHETIC_PRIVATE',bytes=Buffer.from(line+'\n','utf8');
 for(let cut=1;cut<bytes.length;cut++){const out:string[]=[],f=webDiagnosticForwarder(s=>out.push(s));f.push(bytes.subarray(0,cut));f.push(bytes.subarray(cut));f.end();assert.deepEqual(out,['NEXT_DEV_ERROR RUNTIME'],'cut '+cut);}
 const byteByByte:string[]=[],g=webDiagnosticForwarder(s=>byteByByte.push(s));for(const b of bytes)g.push(Uint8Array.of(b));g.end();assert.deepEqual(byteByByte,['NEXT_DEV_ERROR RUNTIME']);
 for(const coloured of ['\u001b[31m ⨯\u001b[39m Error: SYNTHETIC_PRIVATE','\u001b[1m\u001b[31m⨯\u001b[39m\u001b[22m unhandledRejection: SYNTHETIC_PRIVATE'])assert.match(safeWebDiagnostic(coloured)!,/^NEXT_DEV_ERROR (RUNTIME|UNHANDLED)$/);
 const out:string[]=[],h=webDiagnosticForwarder(s=>out.push(s));h.push(Buffer.from('x'.repeat(3000)+' ⨯ Error: SYNTHETIC_PRIVATE\n'));h.push(Buffer.from('⨯ Error: ok\n'));h.end();assert.deepEqual(out,['NEXT_DEV_ERROR RUNTIME']);
 assert.ok(!out.join().includes('PRIVATE')&&!byteByByte.join().includes('PRIVATE'));
});
test('fixture onRequestError record: STAFF_CREATE/probe scope only, finite enums, never the exception or request values',()=>{
 const staff={path:'/api/staff-users',method:'POST'},ctx={routeType:'route'};
 const cases:[unknown,string,string|null,string][]=[[Object.assign(new Error('Cannot find module SYNTHETIC_PRIVATE'),{code:'MODULE_NOT_FOUND'}),'MODULE_NOT_FOUND',null,'Error'],
  [Object.assign(new Error('SYNTHETIC_PRIVATE'),{code:'23505'}),'SQLSTATE','23505','Error'],[Object.assign(new Error('SYNTHETIC_PRIVATE'),{code:'ENOENT'}),'FS_ENOENT',null,'Error'],
  [new TypeError('SYNTHETIC_PRIVATE'),'OTHER',null,'TypeError'],[Object.assign(new Error('x'),{code:'SYNTHETIC_PRIVATE'}),'OTHER',null,'Error'],['SYNTHETIC_PRIVATE string thrown','OTHER',null,'OTHER'],
  [new (class SyntheticPrivateError extends Error{})('SYNTHETIC_PRIVATE'),'OTHER',null,'OTHER'],[{get message(){throw new Error('must not invoke');},get code(){throw new Error('must not invoke');}},'OTHER',null,'OTHER']];
 for(const [error,reason,sqlState,errorType] of cases){const rec=requestErrorRecord(error,staff,ctx)!;assert.deepEqual(rec,{code:'TEST_REQUEST_ERROR',scope:'STAFF_CREATE',routeType:'route',errorType,reason,sqlState});
  const line=JSON.stringify(rec);assert.equal(safeWebDiagnostic(line),line);assert.ok(!line.includes('PRIVATE'));}
 assert.equal(requestErrorRecord(new Error('x'),{path:'/api/staff-users',method:'GET'},ctx),null);
 assert.equal(requestErrorRecord(new Error('x'),{path:'/api/staff-users/'+randomUUID(),method:'PATCH'},ctx),null);
 assert.equal(requestErrorRecord(new Error('x'),{path:'/api/guest/draft',method:'POST'},ctx),null);
 assert.equal(requestErrorRecord(new TypeError('SYNTHETIC_PRIVATE'),{path:'/api/test-diagnostic-probe',method:'GET'},{routeType:'SYNTHETIC_PRIVATE'})!.routeType,'OTHER');
 // The forwarder refuses look-alikes: extra keys, unknown enums or raw text.
 const base={code:'TEST_REQUEST_ERROR',scope:'STAFF_CREATE',routeType:'route',errorType:'Error',reason:'OTHER',sqlState:null};
 for(const bad of [{...base,message:'SYNTHETIC_PRIVATE'},{...base,scope:'SYNTHETIC_PRIVATE'},{...base,reason:'SYNTHETIC_PRIVATE'},{...base,errorType:'SyntheticPrivate'},{...base,sqlState:'SYNTHETIC_PRIVATE'},{...base,sqlState:'OTHER'}])assert.equal(safeWebDiagnostic(JSON.stringify(bad)),null);
});
test('F1: request-error forwarding rejects a duplicate code with an unknown parsed value',()=>{
 const line=JSON.stringify({code:'TEST_REQUEST_ERROR',scope:'STAFF_CREATE',routeType:'route',errorType:'Error',reason:'OTHER',sqlState:null});
 assert.equal(safeWebDiagnostic(line),line);
 assert.equal(safeWebDiagnostic(line.slice(0,-1)+',"code":"SYNTHETIC_PRIVATE"}'),null);
});
test('F2: request-error type classification never invokes constructor getters',()=>{
 for(const error of [new Error('SYNTHETIC_PRIVATE'),new (class extends Error{})('SYNTHETIC_PRIVATE')]){
  let calls=0;Object.defineProperty(error,'constructor',{get(){calls++;return Error;}});
  const rec=requestErrorRecord(error,{path:'/api/staff-users',method:'POST'},{routeType:'route'})!;
  assert.equal(calls,0);assert.equal(rec.errorType,Object.getPrototypeOf(error)===Error.prototype?'Error':'OTHER');assert.ok(!JSON.stringify(rec).includes('PRIVATE'));
 }
});
test('F2: request-error classification never invokes name, message or code getters',()=>{
 let calls=0;const error=new Error(),constructor={get name(){calls++;return 'Error';}};
 Object.defineProperty(error,'constructor',{value:constructor});
 for(const key of ['name','message','code'])Object.defineProperty(error,key,{get(){calls++;throw new Error('SYNTHETIC_PRIVATE');}});
 assert.deepEqual(requestErrorRecord(error,{path:'/api/staff-users',method:'POST'},{routeType:'route'}),{code:'TEST_REQUEST_ERROR',scope:'STAFF_CREATE',routeType:'route',errorType:'Error',reason:'OTHER',sqlState:null});
 assert.equal(calls,0);
});
test('F2: known built-in error prototypes retain their finite types',()=>{
 const cases:[Error,string][]=[[new Error(),'Error'],[new TypeError(),'TypeError'],[new ReferenceError(),'ReferenceError'],[new SyntaxError(),'SyntaxError'],[new RangeError(),'RangeError'],[new AggregateError([]),'AggregateError']];
 for(const [error,errorType] of cases)assert.equal(requestErrorRecord(error,{path:'/api/staff-users',method:'POST'},{routeType:'route'})!.errorType,errorType);
});
