import {createHash} from 'node:crypto';
import {canonical} from '../../../contracts/src/hold';
import {ContentInputError,csvRows} from './bulk-plan';
import {planStockImport,type StockSource,type ImportVariant} from './stock-import-plan';
import {STOCK_IMPORT_HEADER_V2} from '../../../contracts/src/stock-import';
export {STOCK_IMPORT_HEADER_V2};
const header=['source_kind','intent','model_id','season','variant_id','manufacturer_sku','quantity','unit','asset_ids','store_id'];
const digest=(v:unknown)=>createHash('sha256').update(canonical(v)).digest('hex');
export type ImportStage=ReturnType<typeof stageStockImport>;
/** Raw source is never evaluated. Preserve exact source digest, sheet/row provenance,
 * and each original cell alongside normalized fields. No fuzzy model/year/SKU matching. */
export function stageStockImport(text:string,sheet:string,variants:ImportVariant[],prior:Record<string,string>,catalogRevision:string){
 if(!/^[-A-Za-z0-9_ .]{1,100}$/.test(sheet))throw new ContentInputError('SOURCE_LOCATOR_INVALID');
 const raw=csvRows(text),providedHeader=raw.shift()?.join(','),v2=providedHeader===STOCK_IMPORT_HEADER_V2.join(',');if(!v2&&providedHeader!==header.join(','))throw new ContentInputError('IMPORT_HEADER');const columns=v2?STOCK_IMPORT_HEADER_V2:header;
 if(!raw.length)throw new ContentInputError('IMPORT_EMPTY');
 const sourceSha256=createHash('sha256').update(text).digest('hex'),unresolved:{row:number;codes:string[]}[]=[],staged:{row:number;original:string[];normalized:StockSource}[]=[];
 raw.forEach((original,n)=>{const row=n+2;if(original.length!==columns.length){unresolved.push({row,codes:['IMPORT_COLUMNS']});return;}
  const cells=original.map(s=>s.trim());const [sourceKind,intent,modelId,season,variantId,manufacturerSku,quantity,unit,ids,storeId]=cells;
  // Whitespace is normalized; model identifiers/season/case and units are never guessed.
  if(quantity&&!/^(0|[1-9][0-9]{0,4})$/.test(quantity)){unresolved.push({row,codes:['QUANTITY_UNRESOLVED']});return;}
  if(v2&&cells[15]!==''&&!/^[1-9][0-9]{0,2}$/.test(cells[15]!)){unresolved.push({row,codes:['INVALID_BSL']});return;}
  const metadata=v2?{sourceDocument:cells[10]!,sourceRow:cells[11]!,category:cells[12]!,size:cells[13]!,tier:cells[14]!,bslMm:cells[15]===''?null:Number(cells[15]),status:cells[16]!}:undefined;
  const value={...(metadata?{metadata}:{}),documentSha256:sourceSha256,locator:sheet+'!row'+row,sourceKind,intent,modelId,season,variantId,manufacturerSku,quantity:quantity===''?null:Number(quantity),unit,assetIds:ids?ids.split('|').map(s=>s.trim()):[],storeId:storeId||null} as StockSource;
  try{const p=planStockImport([value],variants,prior,catalogRevision);staged.push({row,original:[...original],normalized:value});if(p.entries[0]!.issues.length)unresolved.push({row,codes:p.entries[0]!.issues});}catch(e){unresolved.push({row,codes:[e instanceof ContentInputError?e.code:'IMPORT_SHAPE']});}
 });
 // Cross-row immutable ID/locator checks must be retained, not only per-row validation.
 const plan=staged.length?planStockImport(staged.map(s=>s.normalized),variants,prior,catalogRevision):null;
 for(const entry of plan?.entries??[])if(entry.issues.length){const row=staged.find(s=>s.normalized.locator===entry.source.locator)!.row;if(!unresolved.some(u=>u.row===row))unresolved.push({row,codes:entry.issues});}
 const material={schemaVersion:v2?2:1,sourceSha256,sheet,catalogRevision,staged,unresolved,plan};return {...material,stageSha256:digest(material)};
}
/** Explicit dry-run commit. Rebuild against current trusted catalog/prior source history;
 * a supplied hash is correspondence evidence, not inventory write permission. */
export function commitImportDryRun(stage:ImportStage,expectedSha:string,variants:ImportVariant[],prior:Record<string,string>,currentCatalogRevision:string,existingAssetIds:ReadonlySet<string>){
 const {stageSha256,...material}=stage;if(stageSha256!==expectedSha||digest(material)!==expectedSha||stage.catalogRevision!==currentCatalogRevision)throw new ContentInputError('IMPORT_STAGE_STALE');
 if(stage.unresolved.length||!stage.plan)throw new ContentInputError('IMPORT_UNRESOLVED');
 const plan=planStockImport(stage.staged.map(s=>s.normalized),variants,prior,currentCatalogRevision);
 if(plan.entries.some(e=>e.issues.length))throw new ContentInputError('IMPORT_UNRESOLVED');
 const added=plan.entries.filter(e=>e.disposition==='VALIDATED_PLAN');
 if(added.some(e=>e.source.assetIds.some(id=>existingAssetIds.has(id))))throw new ContentInputError('ASSET_ALREADY_EXISTS');
 return {mode:'DRY_RUN' as const,stageSha256,planSha256:plan.sha256,operations:added.map(e=>({sourceKey:e.sourceKey,sourceHash:e.sourceHash,kind:e.source.unit.startsWith('ASSET_')?'ADD_ASSETS':'ADD_QUANTITY',source:structuredClone(e.source)})),deletedAssetIds:[],missingRowsAreDeletions:false,applied:false,requiresAuthorizedLedgerCommit:true};
}
