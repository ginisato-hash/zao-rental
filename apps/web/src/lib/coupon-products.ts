import {PRICE_PRODUCTS,WEAR_TABLE} from '../../../../packages/contracts/src/pricing';

// Product choices for the coupon form: exactly the keys parseCoupon accepts (PRICE_PRODUCTS + WEAR_TABLE), with readable labels.
const SPORT:Record<string,[string,string]>={SKI:['スキー','Ski'],SNOWBOARD:['スノーボード','Snowboard']};
const KIND:Record<string,[string,string]>={SET:['セット','Set'],EQUIPMENT_ONLY:['板・ビンディングのみ','Equipment only'],BOOTS_ONLY:['ブーツのみ','Boots only'],POLES_ONLY:['ポールのみ','Poles only']};
const AGE:Record<string,[string,string]>={ADULT:['大人','Adult'],KIDS:['子ども','Kids']};
const TIER:Record<string,[string,string]>={REGULAR:['レギュラー','Regular'],PREMIUM:['プレミアム','Premium'],STANDARD:['','']};
export type CouponProductOption={key:string;ja:string;en:string};
export function couponProductOptions():CouponProductOption[]{
 const pick=(m:Record<string,[string,string]>,k:string,i:0|1)=>m[k]?.[i]??k;
 const gear=PRICE_PRODUCTS.map(p=>{const j=[pick(SPORT,p.sport,0),pick(KIND,p.kind,0),pick(AGE,p.age,0),pick(TIER,p.tier,0)].filter(Boolean),e=[pick(SPORT,p.sport,1),pick(KIND,p.kind,1),pick(AGE,p.age,1),pick(TIER,p.tier,1)].filter(Boolean);return {key:p.key,ja:j.join(' / '),en:e.join(' / ')};});
 const wear=Object.keys(WEAR_TABLE).map(k=>{const a=k.endsWith('KIDS')?'KIDS':'ADULT';return {key:k,ja:`ウェアセット / ${pick(AGE,a,0)}`,en:`Wear set / ${pick(AGE,a,1)}`};});
 return [...gear,...wear];
}
