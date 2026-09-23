import assert from 'node:assert/strict';
import {test} from 'node:test';
import {bookingConfirmed,bookingCompleted,bookingStateValid} from '../../packages/contracts/src/booking-state';
test('commercial and development operational states have exact mode pairing',()=>{
 for(const mode of ['SIMULATED_DEV','SQUARE_SANDBOX','SQUARE_PRODUCTION','UNKNOWN'])for(const state of ['CONFIRMED_DEV','COMPLETED_DEV','CONFIRMED','COMPLETED']){
  const confirmed=mode==='SQUARE_PRODUCTION'?state==='CONFIRMED':mode!=='UNKNOWN'&&state==='CONFIRMED_DEV';
  const completed=mode==='SQUARE_PRODUCTION'?state==='COMPLETED':mode!=='UNKNOWN'&&state==='COMPLETED_DEV';
  assert.equal(bookingConfirmed(mode,state),confirmed);assert.equal(bookingCompleted(mode,state),completed);assert.equal(bookingStateValid(mode,state),confirmed||completed);
 }
 assert.equal(bookingStateValid('UNKNOWN','DRAFT'),false);
});
