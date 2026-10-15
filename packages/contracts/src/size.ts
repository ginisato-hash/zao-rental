// R67 canonical comparison boundary for provisional capacity and catalog sizes.
// Source evidence strings (e.g. Source A snowboard "145", boot shell "25/25.5") are never
// rewritten; they are compared through this key. Mirrors SQL provisional_size_key() in 0058.
export type BootRange={lo:number;hi:number};
const LENGTH_FAMILIES=new Set(['SKI','SNOWBOARD','POLE']);
const BOOT_FAMILIES=new Set(['SKI_BOOT','SNOWBOARD_BOOT']);
const num=(n:number)=>String(Number(n.toFixed(1)));
/** Length in whole centimetres from "145", "145 cm", "145cm". Null for anything else. */
export function lengthCm(size:string):number|null{const m=/^(\d{2,3})(?:\.0)?\s*(?:cm)?$/i.exec(size.trim());return m?Number(m[1]):null;}
/** Boot fit range from an exact ("25.5", "25.5 cm") or shared-shell ("25/25.5", "25/25.5 cm") label. */
export function bootRange(size:string):BootRange|null{
 const m=/^(\d{1,2}(?:\.[05])?)(?:\s*\/\s*(\d{1,2}(?:\.[05])?))?\s*(?:cm)?$/i.exec(size.trim());if(!m)return null;
 const lo=Number(m[1]),hi=m[2]===undefined?lo:Number(m[2]);return hi<lo||hi-lo>1?null:{lo,hi};
}
/** Canonical key: lengths "145 cm", boots "25.5 cm" / "25/25.5 cm", other families trimmed text. */
export function canonicalSize(family:string,size:string):string{
 if(LENGTH_FAMILIES.has(family)){const n=lengthCm(size);return n===null?size.trim():n+' cm';}
 if(BOOT_FAMILIES.has(family)){const r=bootRange(size);return r===null?size.trim():(r.lo===r.hi?num(r.lo):num(r.lo)+'/'+num(r.hi))+' cm';}
 return size.trim();
}
export const BOOT_TARGET_OFFSET_CM=1.0;
export const BOOT_MAX_DISTANCE_CM=1.0;
/** Distance from the +1.0 cm target to a boot's fit range (0 when the target is inside the range). */
export function bootDistance(range:BootRange,targetCm:number){return targetCm<range.lo?range.lo-targetCm:targetCm>range.hi?targetCm-range.hi:0;}
/** Closest first; on a tie never prefer a boot smaller than the target over an equal/larger one. */
export function compareBootFit(a:BootRange,b:BootRange,targetCm:number){
 const d=bootDistance(a,targetCm)-bootDistance(b,targetCm);if(Math.abs(d)>1e-9)return d;
 const smallA=a.hi<targetCm?1:0,smallB=b.hi<targetCm?1:0;return smallA-smallB||a.lo-b.lo;
}
