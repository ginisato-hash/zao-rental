import test from 'node:test';
import assert from 'node:assert/strict';
import {staffOperationDiagnostic} from '../../apps/web/src/lib/staff-operation-diagnostic';
test('staff500 diagnostic emits only server-generated correlation, fixed phase and allowlisted SQLSTATE',()=>{
 const error=Object.assign(new Error('SYNTHETIC_PRIVATE_MESSAGE'),{code:'23505',detail:'SYNTHETIC_PRIVATE_DETAIL',password:'SYNTHETIC_PRIVATE_PASSWORD',cookie:'SYNTHETIC_PRIVATE_COOKIE',email:'synthetic@example.invalid',correlationId:'client-controlled'});
 const a=staffOperationDiagnostic(error,'WRITE'),b=staffOperationDiagnostic(error,'WRITE');assert.deepEqual(Object.keys(a),['code','correlationId','phase','category']);assert.equal(a.category,'23505');assert.equal(a.phase,'WRITE');assert.match(a.correlationId,/^[0-9a-f-]{36}$/);assert.notEqual(a.correlationId,b.correlationId);assert.ok(!JSON.stringify(a).includes('SYNTHETIC_PRIVATE'));
});
test('unknown/inherited/getter codes and nested cause never leak into diagnostics',()=>{
 for(const error of [{code:'SYNTHETIC_PRIVATE_CODE'},new Error('SYNTHETIC'),Object.create({code:'23505'}),{get code(){throw new Error('GETTER_MUST_NOT_RUN');}},new Proxy({}, {getOwnPropertyDescriptor(){throw new Error('SYNTHETIC');}}),null])assert.equal(staffOperationDiagnostic(error,'INPUT').category,'OTHER');
});
