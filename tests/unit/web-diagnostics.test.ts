import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {staffOperationDiagnostic} from '../../apps/web/src/lib/staff-operation-diagnostic';
import {safeWebDiagnostic,webDiagnosticForwarder,safeTestTransportFailure} from '../flow/web-diagnostics';
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
});
