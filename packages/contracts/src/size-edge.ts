// SIZE-EDGE (Issue 47 A): fit metadata for sizes outside the normally handled window.
// Pure, side-effect free; the single source for customer, staff and (future) group selectors.
// An edge size is an *inventory candidate*, never a fit guarantee: the store confirms the fit.
import type {BootRange} from './size';
export const RECOMMENDATION_RULE_V1='HEIGHT_MINUS_20_WINDOW_15_BOOT_PLUS_1_V1' as const;
export const RECOMMENDATION_RULE_V2='HEIGHT_MINUS_20_WINDOW_15_BOOT_PLUS_1_EDGE_V2' as const;
export const SUPPORTED_RECOMMENDATION_RULES=[RECOMMENDATION_RULE_V1,RECOMMENDATION_RULE_V2] as const;
export const FIT_KINDS=['NORMAL','EDGE_BELOW','EDGE_ABOVE','NEAREST_AVAILABLE','MANUAL_FIT_REQUIRED'] as const;
export type FitKind=typeof FIT_KINDS[number];
export const FIT_REASONS=['OUTSIDE_HANDLED_RANGE_BELOW','OUTSIDE_HANDLED_RANGE_ABOVE','EDGE_SIZE_UNAVAILABLE_NEAREST_USED','EXCEEDS_AUTO_FIT_LIMIT'] as const;
export type FitReason=typeof FIT_REASONS[number];
export type FitFamily='SKI'|'SNOWBOARD'|'SKI_BOOT'|'SNOWBOARD_BOOT'|'POLE';
/** Provisional, owner-adjustable limits beyond which no online selection is offered (store confirmation request instead). */
export const MANUAL_FIT_LIMIT_CM={board:30,boot:3} as const;
/** Normal handled distance: board +-15 cm window, boot 1.0 cm to the shared-shell range. */
export const NORMAL_DISTANCE_CM={board:15,boot:1} as const;
export type FitPart={family:FitFamily;kind:FitKind;reason:FitReason|null;targetCm:number;handledLoCm:number;handledHiCm:number;offeredLoCm:number;offeredHiCm:number;/** offered nearest end minus target; negative = smaller than the target */diffCm:number};
export type FitMeta={version:'SIZE_FIT_V1';ruleVersion:string;kind:FitKind;parts:FitPart[];requiresStoreConfirmation:boolean};
const r2=(n:number)=>Number(n.toFixed(2));
const SEVERITY:Record<FitKind,number>={NORMAL:0,EDGE_BELOW:1,EDGE_ABOVE:1,NEAREST_AVAILABLE:2,MANUAL_FIT_REQUIRED:3};
/** Signed distance from the target to the offered range (0 when the target lies inside it). */
export function signedDiff(target:number,r:BootRange){return target<r.lo?r2(r.lo-target):target>r.hi?r2(r.hi-target):0;}
/** Classifies one component. `catalog` = numeric handled range of the eligible catalog for that family. */
export function partFit(family:FitFamily,target:number,offered:BootRange,catalog:BootRange,normalMax:number,manualMax:number):FitPart{
 const diff=signedDiff(target,offered),dist=Math.abs(diff);
 const base={family,targetCm:r2(target),handledLoCm:catalog.lo,handledHiCm:catalog.hi,offeredLoCm:offered.lo,offeredHiCm:offered.hi,diffCm:diff};
 if(dist<=normalMax+1e-9)return {...base,kind:'NORMAL',reason:null};
 if(dist>manualMax+1e-9)return {...base,kind:'MANUAL_FIT_REQUIRED',reason:'EXCEEDS_AUTO_FIT_LIMIT'};
 if(target<catalog.lo)return offered.lo===catalog.lo?{...base,kind:'EDGE_BELOW',reason:'OUTSIDE_HANDLED_RANGE_BELOW'}:{...base,kind:'NEAREST_AVAILABLE',reason:'EDGE_SIZE_UNAVAILABLE_NEAREST_USED'};
 if(target>catalog.hi)return offered.hi===catalog.hi?{...base,kind:'EDGE_ABOVE',reason:'OUTSIDE_HANDLED_RANGE_ABOVE'}:{...base,kind:'NEAREST_AVAILABLE',reason:'EDGE_SIZE_UNAVAILABLE_NEAREST_USED'};
 return {...base,kind:'NEAREST_AVAILABLE',reason:'EDGE_SIZE_UNAVAILABLE_NEAREST_USED'};
}
/** Pole sizes are already chosen as the nearest catalogue size; only the range position is reported. */
export function poleFit(target:number,length:number,catalog:BootRange):FitPart{
 const offered={lo:length,hi:length},diff=signedDiff(target,offered);
 const base={family:'POLE' as const,targetCm:r2(target),handledLoCm:catalog.lo,handledHiCm:catalog.hi,offeredLoCm:length,offeredHiCm:length,diffCm:diff};
 if(target>=catalog.lo&&target<=catalog.hi)return {...base,kind:'NORMAL',reason:null};
 // A pole is a staff-adjusted accessory (the technician sets the exact length at hand-out), so it is flagged for store
 // confirmation at any distance but never blocks the online selection of an otherwise bookable set.
 return target<catalog.lo?{...base,kind:length===catalog.lo?'EDGE_BELOW':'NEAREST_AVAILABLE',reason:length===catalog.lo?'OUTSIDE_HANDLED_RANGE_BELOW':'EDGE_SIZE_UNAVAILABLE_NEAREST_USED'}:{...base,kind:length===catalog.hi?'EDGE_ABOVE':'NEAREST_AVAILABLE',reason:length===catalog.hi?'OUTSIDE_HANDLED_RANGE_ABOVE':'EDGE_SIZE_UNAVAILABLE_NEAREST_USED'};
}
/** Overall fit of a candidate: the most severe component; null when every component is NORMAL. */
export function combineFit(parts:FitPart[],ruleVersion:string):FitMeta|null{
 const kind=parts.reduce<FitKind>((k,p)=>SEVERITY[p.kind]>SEVERITY[k]?p.kind:k,'NORMAL');
 return kind==='NORMAL'?null:{version:'SIZE_FIT_V1',ruleVersion,kind,parts,requiresStoreConfirmation:true};
}
export const normalFit=(ruleVersion:string):FitMeta=>({version:'SIZE_FIT_V1',ruleVersion,kind:'NORMAL',parts:[],requiresStoreConfirmation:false});
export const isEdgeFit=(f:{kind:FitKind}|null|undefined)=>Boolean(f&&f.kind!=='NORMAL');
