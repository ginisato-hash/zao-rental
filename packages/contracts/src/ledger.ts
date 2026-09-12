import Ajv from 'ajv';
import schemas from './ledger-input.schema.json';
export const stores = ['MOUNTAIN_BASE', 'ONSEN_BASE'] as const;
export type StoreId = typeof stores[number];
export const resources = ['models', 'variants', 'assets', 'poles', 'bundles'] as const;
export type Resource = typeof resources[number];
export const families = ['SKI', 'SNOWBOARD', 'SKI_BOOT', 'SNOWBOARD_BOOT', 'POLE', 'WEAR', 'WEAR_JACKET', 'WEAR_PANTS'] as const;
export type Family = typeof families[number];
export type LedgerPrincipal = {subject:string; role:'CUSTOMER'|'STAFF'|'ADMIN'; storeIds?:readonly StoreId[]};
export type Provenance = {sourceKind:'SYNTHETIC'|'UNVERIFIED'; sourceDocument:string; sourceLocator:string};
export type LedgerInput = Record<string, unknown>;
export type LedgerRecord = {
  id:string; resource:Resource; name:string; code:string; version:number; notes:string;
  family:Family|'SKI_SET'|'SNOWBOARD_SET'; age?:string; tier?:string; size?:string;
  custody?:string; modelId?:string; variantId?:string; storeId?:StoreId; initialStoreId?:StoreId;
  status?:string; quantity?:number; unit?:string; labelCopies?:number;
  catalogSeason?:string|null; compatibleSports?:string[]|null; bslStatus?:string; bslMm?:number|null; bslEvidence?:string; brand?:string;
  components?:{family:string; quantity:number; unit:string}[];
  sourceKind:string; sourceDocument:string; sourceLocator:string;
  createdAt:string; updatedAt:string;
};
export type LedgerDetail = LedgerRecord & {history:{action:string; actor:string; reason:string; occurredAt:string; before:unknown; after:unknown}[]; locations:{storeId:string; event:string; occurredAt:string}[]};
export type LedgerFilters = {storeId?:string; sport?:string; age?:string; tier?:string; size?:string; status?:string; q?:string; offset?:number};
export class LedgerError extends Error {
  constructor(public readonly code:string, public readonly status:number) {super(code);}
}
const ajv = new Ajv({allErrors:false, strict:true});
const validators = Object.fromEntries(resources.flatMap(resource => ['create','update'].map(operation => {
  const key=`${resource}_${operation}`;
  return [key,ajv.compile({$ref:`#/$defs/${key}`, $defs:schemas.$defs})];
})));
export function parseInput(resource:Resource, operation:'create'|'update', value:unknown):LedgerInput {
  if(!validators[`${resource}_${operation}`]!(value)) throw new LedgerError('INVALID_INPUT',422);
  const v=value as LedgerInput;
  if(resource==='variants'&&operation==='create'){const wear=v.family==='WEAR_JACKET'||v.family==='WEAR_PANTS';if(wear?(v.tier!=='STANDARD'||!Array.isArray(v.compatibleSports)):(v.tier==='STANDARD'||v.compatibleSports!==undefined))throw new LedgerError('INVALID_INPUT',422);}
  return v;
}
export function parseResource(value:string):Resource {
  if(!(resources as readonly string[]).includes(value))throw new LedgerError('NOT_FOUND',404);
  return value as Resource;
}
export function assertId(id:string):void {if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))throw new LedgerError('INVALID_ID',422);}
export function ledgerAccess(principal:LedgerPrincipal|null, write=false):readonly StoreId[] {
  if(!principal?.subject)throw new LedgerError('AUTHENTICATION_REQUIRED',401);
  if(!/^[A-Za-z0-9_-]{1,80}$/.test(principal.subject) || !(write?['ADMIN']:['STAFF','ADMIN']).includes(principal.role))throw new LedgerError('FORBIDDEN',403);
  const scope=principal.storeIds;
  if(!scope?.length || scope.some(s=>!(stores as readonly string[]).includes(s)))throw new LedgerError('STORE_SCOPE_REQUIRED',403);
  return [...new Set(scope)];
}
export function validateFilters(filters:LedgerFilters):void {
  const allowed=['storeId','sport','age','tier','size','status','q','offset'];
  if(Object.keys(filters).some(k=>!allowed.includes(k)))throw new LedgerError('INVALID_FILTER',422);
  for(const [key,values] of Object.entries({storeId:stores,sport:['SKI','SNOWBOARD','WEAR'],age:['ADULT','KIDS'],tier:['REGULAR','PREMIUM','STANDARD'],status:['UNVERIFIED','AVAILABLE','MAINTENANCE','RETIRED']})) {
    const value=filters[key as keyof LedgerFilters];if(value!==undefined && !(values as readonly unknown[]).includes(value))throw new LedgerError('INVALID_FILTER',422);
  }
  for(const value of [filters.size,filters.q])if(value!==undefined && (typeof value!=='string'||value.length>80||!value.trim()))throw new LedgerError('INVALID_FILTER',422);
  if(filters.offset!==undefined && (!Number.isSafeInteger(filters.offset)||filters.offset<0||filters.offset>100000))throw new LedgerError('INVALID_FILTER',422);
}
