import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {flowFixture} from '../flow/fixture';
import {QuoteService} from '../../packages/core/src/pricing/quote-service';
import {flowHash} from '../../packages/contracts/src/rental-flow';
import {deriveApprovedCommercialPriceFacts,type CommercialPriceBook} from '../../packages/core/src/pricing/commercial-price-authority';
const x=await flowFixture();
try{
 const d=await x.draft(undefined,undefined,{reason:'SYNTHETIC commercial price schema proof'});assert.equal(d.quote.chargeReady,false);assert.equal(d.quote.snapshot.chargeReady,false);
 const q=new QuoteService(x.roles.pricingPool,x.principal,x.now,{kind:'COMMERCIAL_PRICE_AUTHORITY'});
 await assert.rejects(q.create(randomUUID(),{conditions:d.conditions,holdId:d.holdId,couponCode:null,wantAdvance:false}),{code:'COMMERCIAL_PRICE_AUTHORITY_REQUIRED'});
 assert.equal((await x.db.pool.query('SELECT count(*)::int n FROM price_quotes')).rows[0].n,1);
 const book=(await x.db.pool.query<CommercialPriceBook>('SELECT * FROM price_books')).rows[0]!;
 // Direct schema fixture only: never an issued identity/authority or a service accept-path claim.
 const snapshot={...d.quote.snapshot,chargeReady:true,commercialApproval:deriveApprovedCommercialPriceFacts(book)};
 const insert=async(value:unknown)=>{const id=randomUUID();await x.db.pool.query("SELECT set_config('zao.actor',$1,false)",[x.actor]);await x.db.pool.query(`INSERT INTO price_quotes(id,actor,request_key,request_fingerprint,book_id,activation_id,coupon_id,hold_id,hold_version,conditions,snapshot,snapshot_sha256,expires_at)
 SELECT $2,actor,$3,request_fingerprint,book_id,activation_id,coupon_id,hold_id,hold_version,conditions,$4,$5,expires_at FROM price_quotes WHERE id=$1`,[d.quote.id,id,randomUUID(),JSON.stringify(value),flowHash(value)]);return id;};
 const id=await insert(snapshot);
 await assert.rejects(x.db.pool.query("UPDATE price_quotes SET snapshot=snapshot||'{\"totalJpy\":1}'::jsonb WHERE id=$1",[id]),{code:'23514'});
 await assert.rejects(insert({...snapshot,commercialApproval:undefined}),{code:'23514'});
 await assert.rejects(insert({...snapshot,commercialApproval:{...snapshot.commercialApproval,revision:3}}),{code:'23514'});
 assert.deepEqual((await x.quotes.get(d.quote.id)).snapshot,d.quote.snapshot);
 console.log('PASS commercial price schema, immutable snapshots, dev chargeReady=false and forged authority rollback; real authority accept path remains attended.');
}finally{await x.close();}
