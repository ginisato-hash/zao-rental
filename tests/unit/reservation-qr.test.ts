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
