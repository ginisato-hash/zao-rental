import {INITIAL_TABLE,WEAR_TABLE} from '../../../../packages/contracts/src/pricing';

/** Public price presentation (R64). Pure lookup into the same tables the quote engine prices from — no arithmetic, no copies.
 * HALF is the morning slot; the afternoon slot has the same price in every product (asserted by price-rows.test.ts). */
export type PriceSport='ski'|'snowboard'|'wear';
type Row={plan:'regular'|'premium';ja:string;en:string;dja:string;den:string;adult?:string;kids?:string};
export const PRICE_ROWS:Record<PriceSport,{en:string;rows:Row[]}>={
 ski:{en:'SKI',rows:[
  {plan:'regular',ja:'セット',en:'SET',dja:'板・ブーツ・ポール',den:'Skis, boots, poles',adult:'SKI_SET_ADULT_REGULAR',kids:'SKI_SET_KIDS_REGULAR'},
  {plan:'regular',ja:'板のみ',en:'SKIS ONLY',dja:'スキー板',den:'Skis',adult:'SKI_EQUIPMENT_ONLY_ADULT_REGULAR',kids:'SKI_EQUIPMENT_ONLY_KIDS_REGULAR'},
  {plan:'regular',ja:'ブーツのみ',en:'BOOTS ONLY',dja:'スキーブーツ',den:'Ski boots',adult:'SKI_BOOTS_ONLY_ADULT_STANDARD',kids:'SKI_BOOTS_ONLY_KIDS_STANDARD'},
  {plan:'regular',ja:'ポールのみ',en:'POLES ONLY',dja:'ストック',den:'Poles',adult:'SKI_POLES_ONLY_ADULT_STANDARD',kids:'SKI_POLES_ONLY_KIDS_STANDARD'},
  {plan:'premium',ja:'セット',en:'SET',dja:'板・ブーツ・ポール／モデル指定',den:'Skis, boots, poles / model chosen',adult:'SKI_SET_ADULT_PREMIUM'},
  {plan:'premium',ja:'板のみ',en:'SKIS ONLY',dja:'スキー板／モデル指定',den:'Skis / model chosen',adult:'SKI_EQUIPMENT_ONLY_ADULT_PREMIUM'}]},
 snowboard:{en:'SNOWBOARD',rows:[
  {plan:'regular',ja:'セット',en:'SET',dja:'ボード・ブーツ',den:'Board, boots',adult:'SNOWBOARD_SET_ADULT_REGULAR',kids:'SNOWBOARD_SET_KIDS_REGULAR'},
  {plan:'regular',ja:'ボードのみ',en:'BOARD ONLY',dja:'スノーボード',den:'Board',adult:'SNOWBOARD_EQUIPMENT_ONLY_ADULT_REGULAR',kids:'SNOWBOARD_EQUIPMENT_ONLY_KIDS_REGULAR'},
  {plan:'regular',ja:'ブーツのみ',en:'BOOTS ONLY',dja:'スノーボードブーツ',den:'Snowboard boots',adult:'SNOWBOARD_BOOTS_ONLY_ADULT_STANDARD',kids:'SNOWBOARD_BOOTS_ONLY_KIDS_STANDARD'},
  {plan:'premium',ja:'セット',en:'SET',dja:'ボード・ブーツ／モデル指定',den:'Board, boots / model chosen',adult:'SNOWBOARD_SET_ADULT_PREMIUM'},
  {plan:'premium',ja:'ボードのみ',en:'BOARD ONLY',dja:'スノーボード／モデル指定',den:'Board / model chosen',adult:'SNOWBOARD_EQUIPMENT_ONLY_ADULT_PREMIUM'}]},
 wear:{en:'WEAR',rows:[
  {plan:'regular',ja:'上下セット',en:'JACKET + PANTS',dja:'ジャケット・パンツ',den:'Jacket, pants',adult:'WEAR_SET_ADULT',kids:'WEAR_SET_KIDS'}]},
};
/** Column order: HALF (morning), then 1–10 days. */
export const PRICE_DAY_INDEX=['HALF_DAY_AM','DAY_1','DAY_2','DAY_3','DAY_4','DAY_5','DAY_6','DAY_7','DAY_8','DAY_9','DAY_10'] as const;
export type PriceGrid=Record<string,number[]>;
const TABLE={...INITIAL_TABLE,...WEAR_TABLE} as Record<string,Record<string,number>>;
/** Every product the explorer shows, as integer JPY per column. Throws if a referenced product or cell is missing. */
export function priceGrid():PriceGrid{
 const keys=[...new Set(Object.values(PRICE_ROWS).flatMap(s=>s.rows.flatMap(r=>[r.adult,r.kids]).filter((k):k is string=>Boolean(k))))];
 return Object.fromEntries(keys.map(k=>{const row=TABLE[k];if(!row)throw new Error('PRICE_PRODUCT_MISSING');
  return [k,PRICE_DAY_INDEX.map(d=>{const v=row[d];if(!Number.isSafeInteger(v))throw new Error('PRICE_CELL_MISSING');return v!;})];}));
}
/** "From" price for a product (one full day), for teasers. */
export function dayPrice(key:string){const v=TABLE[key]?.DAY_1;if(!Number.isSafeInteger(v))throw new Error('PRICE_CELL_MISSING');return v!;}
