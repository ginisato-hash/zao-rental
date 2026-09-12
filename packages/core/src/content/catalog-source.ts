import {createHash} from 'node:crypto';
import {canonical} from '../../../contracts/src/hold';
import {ContentInputError} from './bulk-plan';
export type SourceRow={sourceDocument:string;sourceLocator:string;brand:string;modelName:string;sport:'SKI'|'SNOWBOARD';season:string|null;manufacturerSku:string|null;size:string|null;quantity:number|null;quantityUnit:'PAIRS'|'BOARDS'|'UNKNOWN';intent:'ADD'|'REPLACE'|'UNKNOWN'};
export type CatalogFact={modelId:string;brand:string;modelName:string;sport:SourceRow['sport'];season:string;manufacturerSku:string|null;sourceDocument:string;sourceLocator:string};
const folded=(s:string)=>s.normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
const sha=(x:unknown)=>createHash('sha256').update(canonical(x)).digest('hex');
// Manufacturer range != shop inventory. Candidate identity is never an automatic
// physical-stock import, photograph binding, price mapping or season overwrite.
export function planCatalogSources(rows:SourceRow[],catalog:CatalogFact[]){if(!rows.length||rows.length>2000||Buffer.byteLength(JSON.stringify(rows))>2*1024*1024)throw new ContentInputError('CATALOG_BATCH_LIMIT');const seen=new Set<string>();return rows.map(row=>{
 if(Object.keys(row).sort().join()!==['sourceDocument','sourceLocator','brand','modelName','sport','season','manufacturerSku','size','quantity','quantityUnit','intent'].sort().join()||!['SKI','SNOWBOARD'].includes(row.sport)||![row.sourceDocument,row.sourceLocator,row.brand,row.modelName].every(v=>typeof v==='string'&&v.trim()&&v.length<=300)||row.season!==null&&!/^20\d{2}\/\d{2}$/.test(row.season)||row.manufacturerSku!==null&&(typeof row.manufacturerSku!=='string'||!row.manufacturerSku.trim()||row.manufacturerSku.length>100)||row.size!==null&&(typeof row.size!=='string'||!row.size.trim()||row.size.length>80)||row.quantity!==null&&(!Number.isInteger(row.quantity)||row.quantity<0||row.quantity>10000)||!['PAIRS','BOARDS','UNKNOWN'].includes(row.quantityUnit)||!['ADD','REPLACE','UNKNOWN'].includes(row.intent))throw new ContentInputError('CATALOG_SOURCE_SHAPE');
 const sourceKey=row.sourceDocument+'\n'+row.sourceLocator;if(seen.has(sourceKey))throw new ContentInputError('DUPLICATE_SOURCE_LOCATOR');seen.add(sourceKey);
 const candidates=catalog.filter(c=>folded(c.brand)===folded(row.brand)&&folded(c.modelName)===folded(row.modelName)&&c.sport===row.sport&&(row.season===null||c.season===row.season)&&(row.manufacturerSku===null||c.manufacturerSku===row.manufacturerSku));
 const issues:string[]=[];if(!row.season)issues.push('SEASON_UNCONFIRMED');if(!row.manufacturerSku)issues.push('SKU_UNCONFIRMED');if(candidates.length!==1)issues.push(candidates.length?'AMBIGUOUS_MODEL':'MODEL_NOT_FOUND');if(row.quantity===null)issues.push('QUANTITY_UNCONFIRMED');if(row.quantityUnit==='UNKNOWN')issues.push('QUANTITY_UNIT_UNCONFIRMED');if(row.intent==='UNKNOWN')issues.push('ADD_OR_REPLACE_UNCONFIRMED');
 return {sourceHash:sha(row),source:structuredClone(row),candidateModelIds:candidates.map(c=>c.modelId).sort(),issues,state:'DRAFT_RECONCILIATION' as const,createsStock:false as const,overwritesHistoricalModel:false as const};
 });}
