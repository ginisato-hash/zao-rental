import {test} from 'node:test';
import assert from 'node:assert/strict';
import {bookingIdFromInput} from '../../packages/contracts/src/reservation-qr';
test('booking search accepts a canonical booking UUID or the existing reservation QR payload, never an Asset ID or partial identity',()=>{
 const id='00000000-0000-4000-8000-000000002201';
 assert.equal(bookingIdFromInput(' '+id+' '),id);
 assert.equal(bookingIdFromInput('zao-rental:reservation:'+id),id);
 assert.equal(bookingIdFromInput(' zao-rental:reservation:'+id+' '),id);
 for(const value of [id+'-left',id+'-right','zao-rental:reservation:'+id+'-left','150 cm','unknown',null,undefined,42])assert.equal(bookingIdFromInput(value),null);
});

import {normalizeBookingRef,classifyScan} from '../../packages/contracts/src/reservation-qr';
test('short booking number: # optional, any case, spaces/hyphens ignored, 6 to 8 hex only',()=>{
 for(const v of ['#1A2B3C4D','1a2b3c4d',' # 1a2b 3c4d ','１Ａ２Ｂ３Ｃ４Ｄ','1A2B-3C4D','#1A2B3C','1a2b3c'])assert.equal(normalizeBookingRef(v),v.normalize('NFKC').replace(/[#\s-]/g,'').toUpperCase());
 for(const v of ['','#','12345','1A2B3C4D5','#XYZ12345','00000000-0000-4000-8000-000000002201','zao-rental:reservation:1A2B3C4D',null,undefined,12345678])assert.equal(normalizeBookingRef(v),null);
});
test('classifyScan recognises only exact formats and never treats a URL or another prefix as a code',()=>{
 const id='00000000-0000-4000-8000-000000002201';
 assert.deepEqual(classifyScan('zao-rental:reservation:'+id),{kind:'booking',id});
 assert.deepEqual(classifyScan(' '+id+' '),{kind:'uuid',id});
 assert.deepEqual(classifyScan('#1a2b3c4d'),{kind:'short',ref:'1A2B3C4D'});
 for(const v of ['https://example.com/'+id,'http://evil.test','javascript:alert(1)','zao-rental:asset:'+id,'zao-rental:reservation:1A2B3C4D','zao-rental:reservation:'+id+'-left','hello','',null,{},undefined])assert.deepEqual(classifyScan(v),{kind:'unsupported'},String(v));
});
