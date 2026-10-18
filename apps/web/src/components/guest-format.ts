import {STORE_DISPLAY_NAMES} from '../../../../packages/contracts/src/store-display';
// CH-02: customer-facing store names, amounts and JST times shared by the booking flow and the saved
// booking view. A raw store enum or ISO timestamp is never rendered.
// Store display dictionary (Owner 2026-10-10): only the displayed names change; internal IDs, URLs, DB keys and Square locations
// stay MOUNTAIN_BASE / ONSEN_BASE.
export const STORE_LABEL:Record<string,string>={...STORE_DISPLAY_NAMES};
export const storeName=(ja:boolean,v:string)=>STORE_LABEL[v]??(ja?'店舗':'Store');
export const yen=(ja:boolean,n:unknown)=>{const v=typeof n==='string'&&n.trim()!==''?Number(n):n;return typeof v==='number'&&Number.isFinite(v)?new Intl.NumberFormat(ja?'ja-JP':'en-JP',{style:'currency',currency:'JPY',maximumFractionDigits:0}).format(v):'—';};
/** Display only: a discount amount always reads as a reduction (−¥1,200), whatever sign the estimate carries; 0 stays ¥0. */
export const discountYen=(ja:boolean,n:unknown)=>{const v=typeof n==='string'&&n.trim()!==''?Number(n):n;if(typeof v!=='number'||!Number.isFinite(v))return yen(ja,v);return v===0?yen(ja,0):'−'+yen(ja,Math.abs(v));};
/** Display order for wear size labels: XXS…XL, 2XL/XXL, 3XL/XXXL… then numeric sizes ascending; unknown labels keep their order at the end. */
const LETTER_SIZE=['XXS','XS','S','M','L','XL'];
export const wearSizeRank=(label:string)=>{const v=label.trim().toUpperCase(),i=LETTER_SIZE.indexOf(v);if(i>=0)return i;const x=/^(?:(\d)XL|(X{2,})L)$/.exec(v);if(x)return LETTER_SIZE.length-1+(x[1]?Number(x[1])-1:x[2]!.length-1);const n=/^(\d+(?:\.\d+)?)\s*(?:CM)?$/.exec(v);return n?1000+Number(n[1]):Number.POSITIVE_INFINITY;};
export const byWearSize=<T extends {label:string}>(list:readonly T[])=>list.map((v,i)=>({v,i,r:wearSizeRank(v.label)})).sort((a,b)=>a.r-b.r||a.i-b.i).map(x=>x.v);
export const jstDateTime=(ja:boolean,iso:string)=>{const d=new Date(iso);if(Number.isNaN(d.getTime()))return '—';return new Intl.DateTimeFormat(ja?'ja-JP':'en-JP',{timeZone:'Asia/Tokyo',dateStyle:'medium',timeStyle:'short'}).format(d)+' JST';};
