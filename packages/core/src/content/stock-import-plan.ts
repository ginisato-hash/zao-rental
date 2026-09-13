import {createHash} from 'node:crypto';
import {canonical} from '../../../contracts/src/hold';
import {ContentInputError} from './bulk-plan';
export type StockSource={documentSha256:string;locator:string;sourceKind:'MANUFACTURER'|'SHOP_RECEIPT';intent:'ADD'|'REPLACE'|'UNKNOWN';modelId:string;season:string;variantId:string;manufacturerSku:string;quantity:number|null;unit:'ASSET_PAIR'|'ASSET_BOARD'|'PAIR_QUANTITY'|'PIECE_QUANTITY'|'UNKNOWN';assetIds:string[];storeId:'MOUNTAIN_BASE'|'ONSEN_BASE'|null};
export type ImportVariant={id:string;modelId:string;season:string;manufacturerSku:string;family:'SKI'|'SNOWBOARD'|'SKI_BOOT'|'SNOWBOARD_BOOT'|'POLE'|'WEAR_JACKET'|'WEAR_PANTS'};
const expectedUnit=(v:ImportVariant)=>v.family==='SNOWBOARD'?'ASSET_BOARD':['SKI','SKI_BOOT','SNOWBOARD_BOOT'].includes(v.family)?'ASSET_PAIR':v.family==='POLE'?'PAIR_QUANTITY':'PIECE_QUANTITY';
export function planStockImport(rows:StockSource[],variants:ImportVariant[],prior:Record<string,string>,expectedCatalogRevision:string){
 if(!rows.length||rows.length>2000||Buffer.byteLength(JSON.stringify(rows))>2*1024*1024||!expectedCatalogRevision)throw new ContentInputError('IMPORT_LIMIT');const seen=new Set<string>(),assets=new Set<string>();
 const entries=rows.map(r=>{
  if(Object.keys(r).sort().join()!==['documentSha256','locator','sourceKind','intent','modelId','season','variantId','manufacturerSku','quantity','unit','assetIds','storeId'].sort().join())throw new ContentInputError('IMPORT_SHAPE');
  if(!/^[a-f0-9]{64}$/.test(r.documentSha256)||!r.locator||r.locator.length>300||!['MANUFACTURER','SHOP_RECEIPT'].includes(r.sourceKind)||!['ADD','REPLACE','UNKNOWN'].includes(r.intent)||!/^20\d{2}\/\d{2}$/.test(r.season)||!r.manufacturerSku||r.manufacturerSku.length>100||!Array.isArray(r.assetIds)||r.quantity!==null&&(!Number.isSafeInteger(r.quantity)||r.quantity<0||r.quantity>10000)||!['ASSET_PAIR','ASSET_BOARD','PAIR_QUANTITY','PIECE_QUANTITY','UNKNOWN'].includes(r.unit)||r.storeId!==null&&!['MOUNTAIN_BASE','ONSEN_BASE'].includes(r.storeId))throw new ContentInputError('IMPORT_SHAPE');
  const key=r.documentSha256+':'+r.locator;if(seen.has(key))throw new ContentInputError('IMPORT_DUPLICATE_LOCATOR');seen.add(key);
  const sourceHash=createHash('sha256').update(canonical(r)).digest('hex'),issues:string[]=[],v=variants.filter(v=>v.id===r.variantId&&v.modelId===r.modelId&&v.season===r.season&&v.manufacturerSku===r.manufacturerSku);
  if(v.length!==1)issues.push('EXACT_CATALOG_MAPPING_REQUIRED');if(r.sourceKind!=='SHOP_RECEIPT')issues.push('MANUFACTURER_IS_NOT_STOCK');if(r.intent!=='ADD')issues.push('ADD_REPLACE_OWNER_DECISION_REQUIRED');if(r.quantity===null||r.quantity===0)issues.push('RECEIPT_QUANTITY_REQUIRED');if(!r.storeId)issues.push('RECEIPT_STORE_REQUIRED');
  if(v.length===1){const unit=expectedUnit(v[0]!);if(r.unit!==unit)issues.push('UNIT_MISMATCH');if(unit.startsWith('ASSET_')){if(r.assetIds.length!==r.quantity)issues.push('EXPLICIT_IMMUTABLE_ASSET_IDS_REQUIRED');}else if(r.assetIds.length)issues.push('QUANTITY_STOCK_HAS_NO_ASSET_IDS');}
  for(const id of r.assetIds){if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)||assets.has(id))issues.push('ASSET_ID_DUPLICATE_OR_INVALID');assets.add(id);}
  if(prior[key]&&prior[key]!==sourceHash)issues.push('SOURCE_CHANGED_RECONCILE');
  return {source:structuredClone(r),sourceKey:key,sourceHash,issues,disposition:prior[key]===sourceHash?'ALREADY_IMPORTED':issues.length?'NEEDS_REVIEW':'VALIDATED_PLAN'};
 });
 const material={expectedCatalogRevision,entries};return {...material,sha256:createHash('sha256').update(canonical(material)).digest('hex'),applied:false,createsInventory:false,requiresAuthorizedLedgerCommit:true};
}
