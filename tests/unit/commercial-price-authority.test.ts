import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {INITIAL_TABLE} from '../../packages/contracts/src/pricing';
import {APPROVED_COMMERCIAL_PRICE,deriveApprovedCommercialPriceFacts,issueCommercialPriceAuthority,issueApprovedCommercialPricePermit,approvedCommercialPricePermitAuthority,approvedCommercialPricePermitFacts,commercialPriceApproval,type CommercialPriceBook} from '../../packages/core/src/pricing/commercial-price-authority';
const book=():CommercialPriceBook=>({id:randomUUID(),revision:2,state:'PRIVATE_AVAILABLE',source_sha256:APPROVED_COMMERCIAL_PRICE.equipmentSha256,table_jpy:structuredClone(INITIAL_TABLE)});
test('approved current equipment/wear tables match pinned source revisions and literal digests',()=>{
 const b=book(),facts=deriveApprovedCommercialPriceFacts(b);assert.equal(facts.priceBookId,b.id);assert.equal(facts.revision,2);assert.equal(facts.tablesSha256,APPROVED_COMMERCIAL_PRICE.tablesSha256);assert.ok(Object.isFrozen(facts));
});
test('revision, source digest, state and one yen table mutation each invalidate commercial approval',()=>{
 const b=book(),changed=structuredClone(b.table_jpy),key=Object.keys(changed)[0]!;changed[key]!.DAY_1!++;
 for(const patch of [{revision:3},{source_sha256:'0'.repeat(64)},{state:'DRAFT'},{table_jpy:changed}])assert.throws(()=>deriveApprovedCommercialPriceFacts({...b,...patch}),{code:'COMMERCIAL_PRICE_NOT_APPROVED'});
 assert.notDeepEqual(deriveApprovedCommercialPriceFacts(b),deriveApprovedCommercialPriceFacts({...b,id:randomUUID()}));
});
test('raw facts, flags and forged identity/authority/permit never authorize commercial quotes',()=>{
 const b=book();
 for(const fake of [{kind:'EXACT_PRODUCTION_IDENTITY'},{environment:'PRODUCTION'},{approved:true},undefined])assert.throws(()=>issueCommercialPriceAuthority(fake as never),{code:'PRODUCTION_IDENTITY_REQUIRED'});
 const authority={kind:'COMMERCIAL_PRICE_AUTHORITY'} as const,permit={kind:'APPROVED_COMMERCIAL_PRICE_PERMIT'} as const;
 assert.throws(()=>issueApprovedCommercialPricePermit(authority,b),{code:'COMMERCIAL_PRICE_AUTHORITY_REQUIRED'});
 assert.throws(()=>commercialPriceApproval(authority,b),{code:'COMMERCIAL_PRICE_AUTHORITY_REQUIRED'});
 assert.equal(approvedCommercialPricePermitAuthority(permit),null);assert.equal(approvedCommercialPricePermitAuthority(),null);assert.equal(approvedCommercialPricePermitFacts(permit,b),null);
});
