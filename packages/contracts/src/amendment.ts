import {canonical,parseConditions,normalizePeriod,type HoldConditions} from './hold';
import {calculate,money,WEAR_TABLE,WEAR_PRICE_VERSION,type PriceTable} from './pricing';
import {FlowError} from './rental-flow';
export const AMENDMENT_POLICY='ORIGINAL_BOOK_EXPLICIT_AMENDMENT_M1_LOCAL_V1' as const;
export function amendmentConditions(before:HoldConditions,value:unknown,now:Date):HoldConditions{
 const next=parseConditions(value);
 if(next.reservationId!==before.reservationId||next.pickupStore!==before.pickupStore||next.returnStore!==before.returnStore||next.period.startDate!==before.period.startDate||next.contractVersion!==before.contractVersion)throw new FlowError('AMENDMENT_CONTRACT_IDENTITY_IMMUTABLE',422);
 if(next.members.length!==before.members.length||next.members.some(m=>!before.members.some(old=>old.key===m.key&&old.age===m.age)))throw new FlowError('AMENDMENT_MEMBER_IDENTITY_IMMUTABLE',422);
 if(new Date(normalizePeriod(before.period).dueAt)<=now||new Date(normalizePeriod(next.period).dueAt)<=now)throw new FlowError('AMENDMENT_PERIOD_ENDED',409);
 if(canonical(before)===canonical(next))throw new FlowError('AMENDMENT_UNCHANGED',422);return next;
}
// Local-only implementation of PRICING.md's original-book proposal. Production
// publication remains a separate gate. Original contract and payment rows are never repriced.
export function amendmentPrice(input:{original:Record<string,unknown>;previousTotalJpy:number;conditions:HoldConditions;table:PriceTable;originalPaidAt:Date;committedAdditionalJpy:number}){
 const {original,conditions,table,originalPaidAt}=input;
 money(original.totalJpy);money(input.previousTotalJpy);money(input.committedAdditionalJpy);
 if(original.currency!=='JPY'||original.couponVersionId||Number(original.couponDiscountJpy)!==0)throw new FlowError('AMENDMENT_PROMOTION_REVIEW_REQUIRED',409);
 if((conditions.members.some(m=>m.items.some(i=>i.family.startsWith('WEAR_')))||original.wearPriceVersion)&&(original.wearPriceVersion!==WEAR_PRICE_VERSION||canonical(original.wearPriceTable)!==canonical(WEAR_TABLE)))throw new FlowError('AMENDMENT_ORIGINAL_WEAR_PRICE_UNAVAILABLE',409);
 const target=calculate(table,{conditions,holdId:null,couponCode:null,wantAdvance:Number(original.advanceDiscountJpy)>0},originalPaidAt,null);
 if(Number(original.advanceDiscountJpy)>0&&target.advanceDiscountJpy===0)throw new FlowError('AMENDMENT_PROMOTION_REVIEW_REQUIRED',409);
 const financialBasisJpy=original.totalJpy+input.committedAdditionalJpy;money(financialBasisJpy);
 // A non-refunded reduction does not charge the already accepted amount again
 // when a later amendment restores it. Refund exceptions remain a separate ledger.
 return {policyVersion:AMENDMENT_POLICY,originalPriceBookId:original.priceBookId,originalTotalJpy:original.totalJpy,previousTotalJpy:input.previousTotalJpy,target,
  differenceJpy:target.totalJpy-input.previousTotalJpy,financialBasisJpy,additionalChargeJpy:Math.max(target.totalJpy-financialBasisJpy,0),automaticRefundJpy:0,
  chargeReady:false,productionEnabled:false,meaning:'LOCAL_AMENDMENT_QUOTE_NOT_PROVIDER_PAYMENT' as const};
}
