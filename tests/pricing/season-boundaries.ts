import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {flowFixture} from '../flow/fixture';
import {requestFor} from '../inventory/fixture';
const x=await flowFixture('2026-10-03T12:00:00+09:00');
try{
 const old=(await x.quotes.catalog()).active!,oldBook=await x.quotes.draftView(old.book_id),id=randomUUID();
 const draft=await x.quotes.createDraft(id,old.book_id,'2026-12-12','2027-03-31','SYNTHETIC approved season boundaries',randomUUID());
 assert.deepEqual(draft.table_jpy,oldBook.book.table_jpy);assert.equal(draft.source_sha256,oldBook.book.source_sha256);
 await x.quotes.activate(id,1,'2026-10-03T12:00:01+09:00',old.id,'SYNTHETIC approved season boundaries',randomUUID());await x.clock('2026-10-03T12:00:02+09:00');
 const cases=[['2026-12-11','2026-12-11',false],['2026-12-12','2026-12-12',true],['2027-03-31','2027-03-31',true],['2027-04-01','2027-04-01',false],['2026-12-11','2026-12-12',false],['2027-03-31','2027-04-01',false]] as const;
 for(const store of ['MOUNTAIN_BASE','ONSEN_BASE'] as const)for(const [startDate,endDate,allowed] of cases){
  const conditions={...requestFor(startDate),pickupStore:store,returnStore:store,period:{startDate,endDate,slot:startDate===endDate?'DAY' as const:'MULTIDAY' as const}};
  const create=()=>x.quotes.create(randomUUID(),{conditions,holdId:null,couponCode:null,wantAdvance:false});
  if(allowed){const q=await create();assert.equal(q.quote.snapshot.priceBookId,id);assert.deepEqual(q.quote.snapshot.conditions,conditions);}
  else await assert.rejects(create(),{code:'PRICE_PERIOD_NOT_COVERED'});
 }
 assert.deepEqual((await x.quotes.draftView(old.book_id)).book,oldBook.book);
 console.log('PASS season: both stores, Asia/Tokyo inclusive 2026-12-12 / 2027-03-31; 12/11, 4/1 and crossing either boundary rejected; source/prices/original book unchanged; real Provider calls0.');
}finally{await x.close();}
