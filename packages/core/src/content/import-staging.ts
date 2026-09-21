import {createHash} from 'node:crypto';
import {canonical} from '../../../contracts/src/hold';
import {ContentInputError,csvRows} from './bulk-plan';
import {planStockImport,type StockSource,type ImportVariant} from './stock-import-plan';
import {STOCK_IMPORT_HEADER_V2,STOCK_IMPORT_HEADER_V3} from '../../../contracts/src/stock-import';
export {STOCK_IMPORT_HEADER_V2,STOCK_IMPORT_HEADER_V3};
const header=['source_kind','intent','model_id','season','variant_id','manufacturer_sku','quantity','unit','asset_ids','store_id'];
const digest=(v:unknown)=>createHash('sha256').update(canonical(v)).digest('hex');
export type ImportStage=ReturnType<typeof stageStockImport>;
/** Raw source is never evaluated. Preserve exact source digest, sheet/row provenance,
 * and each original cell alongside normalized fields. No fuzzy model/year/SKU matching. */
export function stageStockImport(text:string,sheet:string,variants:ImportVariant[],prior:Record<string,string>,catalogRevision:string){
 if(!/^[-A-Za-z0-9_ .]{1,100}$/.test(sheet))throw new ContentInputError('SOURCE_LOCATOR_INVALID');
 const raw=csvRows(text),providedHeader=raw.shift()?.join(',');
 const v3=providedHeader===STOCK_IMPORT_HEADER_V3.join(','),v2=v3||providedHeader===STOCK_IMPORT_HEADER_V2.join(',');
 if(!v2&&providedHeader!==header.join(','))throw new ContentInputError('IMPORT_HEADER');const columns=v3?STOCK_IMPORT_HEADER_V3:v2?STOCK_IMPORT_HEADER_V2:header;
 if(!raw.length)throw new ContentInputError('IMPORT_EMPTY');
 const sourceSha256=createHash('sha256').update(text).digest('hex'),unresolved:{row:number;codes:string[]}[]=[],staged:{row:number;original:string[];normalized:StockSource}[]=[];
 raw.forEach((original,n)=>{const row=n+2;if(original.length!==columns.length){unresolved.push({row,codes:['IMPORT_COLUMNS']});return;}
  const cells=original.map(s=>s.trim());const [sourceKind,intent,modelId,season,variantId,manufacturerSku,quantity,unit,ids,storeId]=cells;
  // Whitespace is normalized; model identifiers/season/case and units are never guessed.
  if(quantity&&!/^(0|[1-9][0-9]{0,4})$/.test(quantity)){unresolved.push({row,codes:['QUANTITY_UNRESOLVED']});return;}
  if(v2&&cells[15]!==''&&!/^[1-9][0-9]{0,2}$/.test(cells[15]!)){unresolved.push({row,codes:['INVALID_BSL']});return;}
  const metadata=v2?{sourceDocument:cells[10]!,sourceRow:cells[11]!,category:cells[12]!,size:cells[13]!,tier:cells[14]!,bslMm:cells[15]===''?null:Number(cells[15]),status:cells[16]!,...(v3?{manufacturer:cells[17]!,modelName:cells[18]!,note:cells[19]!}:{})}:undefined;
  const value={...(metadata?{metadata}:{}),documentSha256:sourceSha256,locator:sheet+'!row'+row,sourceKind,intent,modelId,season,variantId,manufacturerSku,quantity:quantity===''?null:Number(quantity),unit,assetIds:ids?ids.split('|').map(s=>s.trim()):[],storeId:storeId||null} as StockSource;
  try{const p=planStockImport([value],variants,prior,catalogRevision);staged.push({row,original:[...original],normalized:value});if(p.entries[0]!.issues.length)unresolved.push({row,codes:p.entries[0]!.issues});}catch(e){unresolved.push({row,codes:[e instanceof ContentInputError?e.code:'IMPORT_SHAPE']});}
 });
 // Cross-row immutable ID/locator checks must be retained, not only per-row validation.
 const plan=staged.length?planStockImport(staged.map(s=>s.normalized),variants,prior,catalogRevision):null;
 for(const entry of plan?.entries??[])if(entry.issues.length){const row=staged.find(s=>s.normalized.locator===entry.source.locator)!.row;if(!unresolved.some(u=>u.row===row))unresolved.push({row,codes:entry.issues});}
 const material={schemaVersion:v3?3:v2?2:1,sourceSha256,sheet,catalogRevision,staged,unresolved,plan};return {...material,stageSha256:digest(material)};
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

/** Categories the dry-run report counts. Each maps to issue codes the existing plan already
 * produces; this summarises that plan and never re-validates or re-interprets a row. */
const REPORT_CODES={
 duplicateAssetId:['ASSET_ID_DUPLICATE_OR_INVALID'],
 duplicateSource:['IMPORT_DUPLICATE_SOURCE','IMPORT_DUPLICATE_LOCATOR'],
 existingConflict:['SOURCE_CHANGED_RECONCILE','ASSET_ALREADY_EXISTS'],
 unknownStore:['RECEIPT_STORE_REQUIRED'],
 unknownCategory:['INVALID_CATEGORY','CATEGORY_MISMATCH'],
 invalidQuantity:['QUANTITY_UNRESOLVED','RECEIPT_QUANTITY_REQUIRED','UNIT_MISMATCH','EXPLICIT_IMMUTABLE_ASSET_IDS_REQUIRED','QUANTITY_STOCK_HAS_NO_ASSET_IDS'],
 unresolvedModel:['EXACT_CATALOG_MAPPING_REQUIRED','EXACT_SIZE_REQUIRED','TIER_MISMATCH','MANUFACTURER_MISMATCH','MODEL_NAME_MISMATCH'],
 unresolvedBsl:['INVALID_BSL'],
 // A row whose shape or column count is wrong never reaches per-field validation.
 malformedRow:['IMPORT_SHAPE','IMPORT_COLUMNS','SOURCE_REQUIRED','INVALID_STATUS','INVALID_NOTE','MANUFACTURER_IS_NOT_STOCK','ADD_REPLACE_OWNER_DECISION_REQUIRED','WEAR_STATUS_REQUIRED'],
} as const;
export type ImportDryRunReport=ReturnType<typeof importDryRunReport>;
/** One safe summary of a staged file. Counts and fixed codes only: no cell value, no note
 * text and no customer material can reach it. Every blocking row must be resolved in the
 * source file before a commit is possible. */
export function importDryRunReport(stage:ImportStage,existingAssetIds:ReadonlySet<string>=new Set()){
 const codesByRow=new Map<number,Set<string>>();
 const add=(row:number,codes:readonly string[])=>{const set=codesByRow.get(row)??new Set<string>();for(const code of codes)set.add(code);codesByRow.set(row,set);};
 for(const u of stage.unresolved)add(u.row,u.codes);
 for(const entry of stage.plan?.entries??[]){
  const staged=stage.staged.find(s=>s.normalized.locator===entry.source.locator);if(!staged)continue;
  add(staged.row,entry.issues);
  if(entry.disposition!=='ALREADY_IMPORTED'&&entry.source.assetIds.some(id=>existingAssetIds.has(id)))add(staged.row,['ASSET_ALREADY_EXISTS']);
 }
 const dispositions=new Map<number,string>();
 for(const entry of stage.plan?.entries??[]){const staged=stage.staged.find(s=>s.normalized.locator===entry.source.locator);if(staged)dispositions.set(staged.row,entry.disposition);}
 const rows=stage.staged.map(s=>({row:s.row,codes:[...(codesByRow.get(s.row)??new Set<string>())].sort(),disposition:dispositions.get(s.row)??'UNPARSED',unit:s.normalized.unit}));
 for(const u of stage.unresolved)if(!rows.some(r=>r.row===u.row))rows.push({row:u.row,codes:[...u.codes].sort(),disposition:'UNPARSED',unit:'UNKNOWN'});
 const blocking=rows.filter(r=>r.codes.length),clean=rows.filter(r=>!r.codes.length);
 const alreadyImported=clean.filter(r=>r.disposition==='ALREADY_IMPORTED');
 const applicable=clean.filter(r=>r.disposition==='VALIDATED_PLAN');
 const counted=Object.fromEntries(Object.entries(REPORT_CODES).map(([name,codes])=>[name,rows.filter(r=>r.codes.some(c=>(codes as readonly string[]).includes(c))).length])) as Record<keyof typeof REPORT_CODES,number>;
 return {
  schemaVersion:stage.schemaVersion,sourceSha256:stage.sourceSha256,stageSha256:stage.stageSha256,sheet:stage.sheet,
  totalRows:rows.length,
  valid:clean.length,
  // Nothing here is advisory: a row that already exists is reported as a warning because it
  // needs no action, and every remaining issue blocks the commit.
  warning:alreadyImported.length,
  blockingError:blocking.length,
  ...counted,
  // Asset-backed rows create immutable Assets; pole and wear rows add to an existing pool.
  wouldCreate:applicable.filter(r=>r.unit.startsWith('ASSET_')).length,
  wouldUpdate:applicable.filter(r=>!r.unit.startsWith('ASSET_')).length,
  ignoredNoop:alreadyImported.length,
  committable:blocking.length===0&&applicable.length>0&&stage.schemaVersion>=2,
  rows:rows.sort((a,b)=>a.row-b.row).map(r=>({row:r.row,disposition:r.disposition,codes:r.codes})),
 };
}
