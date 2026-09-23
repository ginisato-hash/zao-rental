import {createHash} from 'node:crypto';
import {canonical} from '../../../contracts/src/hold';
import {ContentInputError} from './bulk-plan';
export type StockMetadata={sourceDocument:string;sourceRow:string;category:string;size:string;tier:string;status:'UNVERIFIED'|'AVAILABLE'|'MAINTENANCE'|'RETIRED';bslMm:number|null;manufacturer?:string;modelName?:string;note?:string};
export type StockSource={documentSha256:string;locator:string;sourceKind:'MANUFACTURER'|'SHOP_RECEIPT';intent:'ADD'|'REPLACE'|'UNKNOWN';modelId:string;season:string;variantId:string;manufacturerSku:string;quantity:number|null;unit:'ASSET_PAIR'|'ASSET_BOARD'|'PAIR_QUANTITY'|'PIECE_QUANTITY'|'UNKNOWN';assetIds:string[];storeId:'MOUNTAIN_BASE'|'ONSEN_BASE'|null;metadata?:StockMetadata};
export type ImportVariant={id:string;modelId:string;season:string;manufacturerSku:string;size?:string;tier?:string;brand?:string;modelName?:string;family:'SKI'|'SNOWBOARD'|'SKI_BOOT'|'SNOWBOARD_BOOT'|'POLE'|'WEAR_JACKET'|'WEAR_PANTS'};
const expectedUnit=(v:ImportVariant)=>v.family==='SNOWBOARD'?'ASSET_BOARD':['SKI','SKI_BOOT','SNOWBOARD_BOOT'].includes(v.family)?'ASSET_PAIR':v.family==='POLE'?'PAIR_QUANTITY':'PIECE_QUANTITY';
export function planStockImport(rows:StockSource[],variants:ImportVariant[],prior:Record<string,string>,expectedCatalogRevision:string,approvedFamilyScope?:readonly ImportVariant['family'][]){
 if(!rows.length||rows.length>2000||Buffer.byteLength(JSON.stringify(rows))>2*1024*1024||!expectedCatalogRevision)throw new ContentInputError('IMPORT_LIMIT');const seen=new Set<string>(),assets=new Set<string>();
 const entries=rows.map(r=>{
  if(Object.keys(r).sort().join()!==['documentSha256','locator','sourceKind','intent','modelId','season','variantId','manufacturerSku','quantity','unit','assetIds','storeId',...(r.metadata?['metadata']:[])].sort().join())throw new ContentInputError('IMPORT_SHAPE');
  if(!/^[a-f0-9]{64}$/.test(r.documentSha256)||!r.locator||r.locator.length>300||!['MANUFACTURER','SHOP_RECEIPT'].includes(r.sourceKind)||!['ADD','REPLACE','UNKNOWN'].includes(r.intent)||!/^20\d{2}\/\d{2}$/.test(r.season)||(!r.manufacturerSku&&!r.metadata)||r.manufacturerSku.length>100||!Array.isArray(r.assetIds)||r.quantity!==null&&(!Number.isSafeInteger(r.quantity)||r.quantity<0||r.quantity>10000)||!['ASSET_PAIR','ASSET_BOARD','PAIR_QUANTITY','PIECE_QUANTITY','UNKNOWN'].includes(r.unit)||r.storeId!==null&&!['MOUNTAIN_BASE','ONSEN_BASE'].includes(r.storeId))throw new ContentInputError('IMPORT_SHAPE');
  const key=r.metadata?'source:'+createHash('sha256').update(canonical([r.metadata.sourceDocument,r.metadata.sourceRow])).digest('hex'):r.documentSha256+':'+r.locator;const duplicateSource=seen.has(key);if(duplicateSource&&!r.metadata)throw new ContentInputError('IMPORT_DUPLICATE_LOCATOR');seen.add(key);
  const sourceMaterial=r.metadata?{...r,documentSha256:'FILE_DIGEST_RECORDED_SEPARATELY',locator:r.metadata.sourceRow}:r;
  const sourceHash=createHash('sha256').update(canonical(sourceMaterial)).digest('hex'),issues:string[]=duplicateSource?['IMPORT_DUPLICATE_SOURCE']:[],v=variants.filter(v=>v.id===r.variantId&&v.modelId===r.modelId&&v.season===r.season&&v.manufacturerSku===r.manufacturerSku);
  if(v.length!==1)issues.push('EXACT_CATALOG_MAPPING_REQUIRED');if(v.length===1&&approvedFamilyScope&&!approvedFamilyScope.includes(v[0]!.family))issues.push('FAMILY_NOT_IN_APPROVED_SCOPE');if(r.sourceKind!=='SHOP_RECEIPT')issues.push('MANUFACTURER_IS_NOT_STOCK');if(r.intent!=='ADD')issues.push('ADD_REPLACE_OWNER_DECISION_REQUIRED');if(r.quantity===null||r.quantity===0)issues.push('RECEIPT_QUANTITY_REQUIRED');if(!r.storeId)issues.push('RECEIPT_STORE_REQUIRED');
  if(v.length===1){const unit=expectedUnit(v[0]!);if(r.unit!==unit)issues.push('UNIT_MISMATCH');if(unit.startsWith('ASSET_')){if(r.assetIds.length!==r.quantity)issues.push('EXPLICIT_IMMUTABLE_ASSET_IDS_REQUIRED');}else if(r.assetIds.length)issues.push('QUANTITY_STOCK_HAS_NO_ASSET_IDS');}
  for(const id of r.assetIds){if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)||assets.has(id))issues.push('ASSET_ID_DUPLICATE_OR_INVALID');assets.add(id);}
  if(r.metadata){const m=r.metadata;
   if(Object.keys(m).sort().join()!==['sourceDocument','sourceRow','category','size','tier','status','bslMm',...(m.manufacturer===undefined?[]:['manufacturer']),...(m.modelName===undefined?[]:['modelName']),...(m.note===undefined?[]:['note'])].sort().join()||typeof m.sourceDocument!=='string'||!m.sourceDocument.trim()||m.sourceDocument.length>120||typeof m.sourceRow!=='string'||!m.sourceRow.trim()||m.sourceRow.length>80)issues.push('SOURCE_REQUIRED');
   if(!['SKI','SNOWBOARD','SKI_BOOT','SNOWBOARD_BOOT','POLE','WEAR_JACKET','WEAR_PANTS'].includes(m.category))issues.push('INVALID_CATEGORY');
   if(typeof m.size!=='string'||!m.size.trim()||m.size.length>80||v.length===1&&m.size!==v[0]!.size)issues.push('EXACT_SIZE_REQUIRED');
   if(!['REGULAR','PREMIUM','STANDARD'].includes(m.tier)||v.length===1&&m.tier!==v[0]!.tier)issues.push('TIER_MISMATCH');
   if(v.length===1&&m.category!==v[0]!.family)issues.push('CATEGORY_MISMATCH');
   if(!['UNVERIFIED','AVAILABLE','MAINTENANCE','RETIRED'].includes(m.status))issues.push('INVALID_STATUS');
   if(m.bslMm!==null&&(m.category!=='SKI_BOOT'||!Number.isInteger(m.bslMm)||m.bslMm<1||m.bslMm>999))issues.push('INVALID_BSL');
   if(['WEAR_JACKET','WEAR_PANTS'].includes(m.category)&&!['AVAILABLE','UNVERIFIED','MAINTENANCE','RETIRED'].includes(m.status))issues.push('WEAR_STATUS_REQUIRED');
   // Manufacturer and model name are matched exactly against the authoritative catalog.
   if(m.manufacturer!==undefined&&(typeof m.manufacturer!=='string'||!m.manufacturer.trim()||m.manufacturer.length>80||(v.length===1&&m.manufacturer!==v[0]!.brand)))issues.push('MANUFACTURER_MISMATCH');
   if(m.modelName!==undefined&&(typeof m.modelName!=='string'||!m.modelName.trim()||m.modelName.length>160||(v.length===1&&m.modelName!==v[0]!.modelName)))issues.push('MODEL_NAME_MISMATCH');
   // Internal equipment note only. Control characters are refused and no customer
   // information belongs here; the field stays optional and may be empty.
   if(m.note!==undefined&&(typeof m.note!=='string'||m.note.length>160||/[\u0000-\u001f\u007f]/.test(m.note)))issues.push('INVALID_NOTE');
  }
  if(prior[key]&&prior[key]!==sourceHash)issues.push('SOURCE_CHANGED_RECONCILE');
  return {source:structuredClone(r),sourceKey:key,sourceHash,issues,disposition:prior[key]===sourceHash?'ALREADY_IMPORTED':issues.length?'NEEDS_REVIEW':'VALIDATED_PLAN'};
 });
 const material={expectedCatalogRevision,approvedFamilyScope:approvedFamilyScope?[...approvedFamilyScope].sort():null,entries};return {...material,sha256:createHash('sha256').update(canonical(material)).digest('hex'),applied:false,createsInventory:false,requiresAuthorizedLedgerCommit:true};
}
