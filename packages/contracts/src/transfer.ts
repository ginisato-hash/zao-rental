import {HoldError,utcDate,canonical} from './hold';
import type {StoreId} from './ledger';
export {canonical};
export class TransferError extends HoldError{}
export type TransferLine={assetId:string}|{poleId:string;quantity:number};
export type TransferPlan={sourceStore:StoreId;destinationStore:StoreId;scheduledDate:string;plannedReadyAt:string;neededBy:string;basis:string;lines:TransferLine[]};
export type TransferOperation='create'|'add'|'dispatch'|'receive'|'ready'|'cancel'|'issue';
export function uuid(v:unknown):asserts v is string{if(typeof v!=='string'||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(v))throw new TransferError('INVALID_ID');}
export function object(v:unknown,keys:string[]):Record<string,unknown>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join(',')!==keys.sort().join(','))throw new TransferError('INVALID_INPUT');return v as Record<string,unknown>;}
export function lines(v:unknown):TransferLine[]{if(!Array.isArray(v)||!v.length||v.length>40)throw new TransferError('INVALID_LINES');let n=0;const ids=new Set<string>();return v.map(x=>{const a=x&&typeof x==='object'&&'assetId'in x,b=object(x,a?['assetId']:['poleId','quantity']);uuid(a?b.assetId:b.poleId);const id=(a?b.assetId:b.poleId) as string;if(ids.has(id))throw new TransferError('DUPLICATE_LINE');ids.add(id);const qty=a?1:b.quantity;if(!Number.isInteger(qty)||(qty as number)<1||(qty as number)>100||(n+=qty as number)>200)throw new TransferError('INVALID_QUANTITY');return a?{assetId:id}:{poleId:id,quantity:qty as number};});}
export function parsePlan(v:unknown):TransferPlan{const p=object(v,['sourceStore','destinationStore','scheduledDate','plannedReadyAt','neededBy','basis','lines']);for(const s of [p.sourceStore,p.destinationStore])if(!['MOUNTAIN_BASE','ONSEN_BASE'].includes(s as string))throw new TransferError('INVALID_STORE');if(p.sourceStore===p.destinationStore)throw new TransferError('INVALID_STORE');if(typeof p.scheduledDate!=='string')throw new TransferError('INVALID_DATE');utcDate(p.scheduledDate);
 for(const t of [p.plannedReadyAt,p.neededBy])if(typeof t!=='string'||!/^20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?(?:Z|\+09:00)$/.test(t)||!Number.isFinite(Date.parse(t))||new Date(Date.parse(t)+(t.endsWith('+09:00')?9*3600000:0)).toISOString().slice(0,19)!==t.slice(0,19))throw new TransferError('INVALID_TIME');
 if(Date.parse(p.plannedReadyAt as string)<Date.parse(p.scheduledDate+'T17:00:00+09:00')||Date.parse(p.neededBy as string)<Date.parse(p.plannedReadyAt as string))throw new TransferError('INVALID_READY_ESTIMATE');
 if(typeof p.basis!=='string'||!p.basis.trim()||p.basis.length>160)throw new TransferError('INVALID_BASIS');return {...p,lines:lines(p.lines)} as TransferPlan;
}
export function tokyoDate(now:Date){return new Date(now.getTime()+9*3600000).toISOString().slice(0,10);}
