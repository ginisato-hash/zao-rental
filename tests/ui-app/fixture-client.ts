import type {LedgerClient} from '../../apps/web/src/components/ledger/client';
import type {LedgerRecord,LedgerDetail,Resource,LedgerInput} from '../../packages/contracts/src/ledger';
import {SAMPLE} from '../fixtures/ledger-sample';
const rows=new Map<string,LedgerDetail>();
function record(resource:Resource,id:string,data:LedgerInput):LedgerDetail {
 const model=resource==='variants'?rows.get(data.modelId as string):undefined;
 const variant=['assets','poles'].includes(resource)?rows.get(data.variantId as string):undefined;
 const family=(data.family??variant?.family) as LedgerRecord['family'];
 const common={id,resource,name:String(data.name??model?.name??variant?.name),code:String(data.code??id),family,notes:String(data.notes),version:1,sourceKind:String(data.sourceKind),sourceDocument:String(data.sourceDocument),sourceLocator:String(data.sourceLocator),createdAt:'2026-09-11T00:00:00Z',updatedAt:'2026-09-11T00:00:00Z'};
 const row={...common,...data,...(variant?{age:variant.age,tier:variant.tier,size:variant.size}:{}),...(resource==='assets'?{unit:family==='SNOWBOARD'?'BOARD':'PAIR',labelCopies:family==='SKI'?2:1,initialStoreId:data.storeId}:{}),...(resource==='poles'?{unit:'PAIR'}:{})} as LedgerDetail;
 if(resource==='bundles')row.components=(family==='SKI_SET'?['SKI','SKI_BOOT','POLE']:['SNOWBOARD','SNOWBOARD_BOOT']).map(f=>({family:f,quantity:1,unit:f==='SNOWBOARD'?'BOARD':'PAIR'}));
 row.history=[{action:'REGISTER',actor:'ui-fixture',reason:'合成サンプル登録',occurredAt:common.createdAt,before:null,after:{...common}}];
 row.locations=resource==='assets'?[{storeId:data.storeId as string,event:'INITIAL_REGISTRATION',occurredAt:common.createdAt}]:[];return row;
}
for(const resource of ['models','variants','assets','poles','bundles'] as const)for(const entry of SAMPLE[resource])rows.set(entry.id,record(resource,entry.id,entry.data));
const copy=<T,>(value:T):T=>structuredClone(value);
const sizeKey=(value:unknown)=>String(value??'').replace(/[ \t\r\n\f\v]+/g,'').replace(/[A-Z]/g,c=>c.toLowerCase());
export const fixtureClient:LedgerClient={
 async list(resource,filters={}){let items=[...rows.values()].filter(r=>r.resource===resource);for(const [key,value] of Object.entries(filters)){if(key==='offset')continue;if(key==='q')items=items.filter(r=>(r.name+' '+r.code+' '+r.size).toLowerCase().includes(String(value).toLowerCase()));else if(key==='size')items=items.filter(r=>sizeKey(r.size)===sizeKey(value));else if(key==='sport')items=items.filter(r=>value==='SKI'?['SKI','SKI_BOOT','POLE','SKI_SET'].includes(r.family):value==='SNOWBOARD'?['SNOWBOARD','SNOWBOARD_BOOT','SNOWBOARD_SET'].includes(r.family):r.family==='WEAR');else items=items.filter(r=>r[key as keyof LedgerDetail]===value);}return copy({items:items.slice(filters.offset??0,(filters.offset??0)+100),total:items.length});},
 async get(resource,id){const row=rows.get(id);if(!row||row.resource!==resource)throw new Error('NOT_FOUND');return copy(row);},
 async create(resource,data){const id=crypto.randomUUID();const row=record(resource,id,data);rows.set(id,row);return copy(row);},
 async update(resource,id,data){const row=rows.get(id);if(!row||row.resource!==resource)throw new Error('NOT_FOUND');if(row.version!==data.version)throw new Error('STALE_VERSION');const before=copy(row);const {version,reason,...patch}=data;Object.assign(row,patch,{version:Number(version)+1});row.history.push({action:'UPDATE',actor:'ui-fixture',reason:String(reason),occurredAt:'2026-09-11T01:00:00Z',before,after:copy(patch)});return copy(row);},
};
