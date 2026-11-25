import {test} from 'node:test';
import assert from 'node:assert/strict';
import {redactDiagnosticMessage,safeDiagnostic} from '../../apps/web/src/lib/safe-diagnostic';
test('a diagnostic carries the SQLSTATE and a redacted message, never an identifier, address or long number',()=>{
 const m=redactDiagnosticMessage('permission denied for table rental_x; booking 9ee2f71e-a58f-4d8a-bf44-0d9cc2200bf5 for a.b@example.com amount 1234567 token deadbeefdeadbeefdeadbeef');
 assert.equal(m,'permission denied for table rental_x; booking <id> for <mail> amount <n> token <hex>');
 const d=safeDiagnostic('custody',Object.assign(new Error('relation "x" does not exist'),{code:'42P01',table:'x',secret:'never'}));
 assert.deepEqual(d,{route:'custody',errorName:'Error',pgCode:'42P01',table:'x',column:undefined,routine:undefined,message:'relation "x" does not exist'});
 assert.equal(JSON.stringify(d).includes('never'),false);
 assert.equal(safeDiagnostic('bad route!',null).route,'unknown');
 assert.equal(safeDiagnostic('custody',{code:'not-a-state'}).pgCode,undefined);
});
