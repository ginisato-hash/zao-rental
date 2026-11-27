import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePre0065Recovery,validateRetainedSourceCopy,RETAINED_SOURCE_COPY_VERSION,PRE_0065_RECOVERY_VERSION,PRE_0065_MAX_AGE_MS} from '../../scripts/production-recovery-evidence-pre0065';
const now=new Date('2026-11-28T00:00:00.000Z');
const good=(over:Record<string,unknown>={})=>({version:PRE_0065_RECOVERY_VERSION,kind:'NEON_RESTORE_POINT',registry:64,recordedAt:'2026-11-27T23:00:00.000Z',reference:'neon-restore-point:2026-11-27T22:59:30Z',...over});
test('a fresh, fixed-shape pre-0065 recovery record for a 64-migration database is accepted',()=>{
 assert.deepEqual(validatePre0065Recovery(good(),now),{kind:'NEON_RESTORE_POINT',recordedAt:'2026-11-27T23:00:00.000Z',registry:64});
 assert.equal(validatePre0065Recovery(good({kind:'RESTORE_DRILL'}),now).kind,'RESTORE_DRILL');
});
test('every other shape is refused with one fixed code (63-migration drill, stale, future, extra keys, bad kind/reference)',()=>{
 const refuse=/PRODUCTION_INSTALL_PRE0065_RECOVERY_REQUIRED/;
 for(const bad of [good({registry:63}),good({kind:'BACKUP'}),good({reference:'x'}),good({reference:'has space and \n newline'}),good({recordedAt:'2026-11-27 23:00'}),good({recordedAt:new Date(now.getTime()-PRE_0065_MAX_AGE_MS-1000).toISOString()}),good({recordedAt:'2026-11-28T00:05:00.000Z'}),good({extra:'secret'}),good({version:'x'}),null,[],'text'])
  assert.throws(()=>validatePre0065Recovery(bad,now),refuse,JSON.stringify(bad));
 const {reference,...missing}=good();void reference;assert.throws(()=>validatePre0065Recovery(missing,now),refuse);
});
test('the retained source copy is a separate, explicitly NON-independent record and never passes as independent backup evidence',()=>{
 const copy={version:RETAINED_SOURCE_COPY_VERSION,kind:'RETAINED_SOURCE_COPY',independent:false,registry:64,recordedAt:'2026-11-27T23:00:00.000Z',reference:'neondb-retained:0123456789abcdef'};
 assert.deepEqual(validateRetainedSourceCopy(copy,now),{kind:'RETAINED_SOURCE_COPY',independent:false,recordedAt:'2026-11-27T23:00:00.000Z',registry:64});
 assert.throws(()=>validatePre0065Recovery({...copy,version:PRE_0065_RECOVERY_VERSION,independent:undefined},now),/PRE0065_RECOVERY_REQUIRED/,'not accepted as independent evidence');
 assert.throws(()=>validatePre0065Recovery({version:PRE_0065_RECOVERY_VERSION,kind:'RETAINED_SOURCE_COPY',registry:64,recordedAt:copy.recordedAt,reference:copy.reference},now),/PRE0065_RECOVERY_REQUIRED/);
 assert.throws(()=>validateRetainedSourceCopy({...copy,independent:true},now),/PRE0065_RECOVERY_REQUIRED/);
 assert.throws(()=>validateRetainedSourceCopy({...copy,kind:'RESTORE_DRILL'},now),/PRE0065_RECOVERY_REQUIRED/);
});
