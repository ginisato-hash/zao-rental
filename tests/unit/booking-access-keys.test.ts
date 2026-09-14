import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createHmac} from 'node:crypto';
import {deriveBookingAccessKeys} from '../../packages/core/src/guest/booking-access-keys';
const master=Buffer.alloc(32,0x5a); // Public, synthetic-only known vector; not a credential.
test('P5-F1 runtime root keys resist even an accidental same-purpose message collision',()=>{
 const keys=deriveBookingAccessKeys(master);assert.equal(keys.accessKey.equals(keys.recoveryKey),false);
 const sameMessage='SYNTHETIC_ACCIDENTAL_IDENTICAL_PURPOSE_AND_MESSAGE';
 assert.equal(createHmac('sha256',keys.accessKey).update(sameMessage).digest().equals(createHmac('sha256',keys.recoveryKey).update(sameMessage).digest()),false);
});
test('P5-F1 preserves the P4 read root vector and deterministic recovery replay; no default weak secret',()=>{
 const keys=deriveBookingAccessKeys(master);assert.equal(createHash('sha256').update(keys.accessKey).digest('hex'),'96b447dadd66b65ec1f0873588db2d45e025ccdfaa86cfd160eb2b780e64dabd');
 assert.equal(keys.recoveryKey.equals(deriveBookingAccessKeys(Buffer.from(master)).recoveryKey),true);
 assert.equal(keys.recoveryKey.equals(deriveBookingAccessKeys(Buffer.alloc(32,0x59)).recoveryKey),false);
 assert.throws(()=>deriveBookingAccessKeys(''),{code:'BOOKING_ACCESS_UNCONFIGURED'});
});
