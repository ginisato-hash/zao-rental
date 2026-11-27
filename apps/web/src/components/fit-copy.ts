// SIZE-EDGE customer/staff copy (JA/EN). An edge size is an inventory candidate, never a fit guarantee.
import type {FitKind,FitMeta} from '../../../../packages/contracts/src/size-edge';
const BADGE:Record<FitKind,[string,string]>={
 NORMAL:['おすすめ範囲','Within handled range'],
 EDGE_BELOW:['取扱サイズの下限','Smallest size we handle'],
 EDGE_ABOVE:['取扱サイズの上限','Largest size we handle'],
 NEAREST_AVAILABLE:['最も近い在庫','Nearest available size'],
 MANUAL_FIT_REQUIRED:['店舗確認が必要','Store confirmation required']
};
export const fitBadge=(kind:FitKind,ja:boolean)=>BADGE[kind][ja?0:1];
export const fitNotice=(ja:boolean)=>ja?'取扱サイズ範囲外のため、最も近いサイズを表示しています。店舗で適合確認が必要です。':'This is outside the sizes we normally handle, so the nearest size is shown. The store must confirm the fit.';
export const fitManualNotice=(ja:boolean)=>ja?'この条件に合う用品はオンラインではご案内できません。自動での確保・お支払いは行いません。店舗へお問い合わせください。':'We cannot offer equipment for these measurements online. Nothing is held or charged automatically. Please contact the store.';
/** Compact staff-facing line per component, e.g. "SKI_BOOT -1.5 cm (25/25.5 cm)". */
export const fitPartLine=(p:FitMeta['parts'][number])=>p.family+' '+(p.diffCm>0?'+':'')+p.diffCm+' cm ('+p.offeredLoCm+(p.offeredHiCm!==p.offeredLoCm?'/'+p.offeredHiCm:'')+' cm)';
