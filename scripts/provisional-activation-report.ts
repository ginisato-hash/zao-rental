// Read-only pre-registration report for the committed provisional Source A/B activation payloads.
// No database, network or file write: it reads the two committed payload JSON files and, if given,
// a catalog variant list (for example a read-only export of Production ledger_variants taken at
// activation time), and prints JSON. It never edits a payload or invents a catalog variant.
//
// Why three numbers per bucket: provisionalCapacity() (packages/core/src/inventory/provisional-
// capacity.ts) matches a requirement to a bucket by exact family/age/booking_size string, and the
// requirement's size is the requested ledger_variants.size (allocation.ts). A MAPPED bucket whose
// booking size has no identical requestable catalog variant can never satisfy a booking, and a
// variant the guest recommender cannot parse (recommendation.ts centimetres(): "<n> cm") is not
// guest-requestable for gear/boots. Family totals therefore are not bookable capacity.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {centimetres} from '../packages/contracts/src/recommendation';

export type PayloadBucket={family:string;age:'ADULT'|'KIDS';sourceSize:string;bookingSize:string|null;quantity:number;provenance:string};
export type Payload={sourceSha256:string;originalFilename:string;buckets:PayloadBucket[]};
export type CatalogVariant={family:string;age:'ADULT'|'KIDS';size:string;tier:string};
const WEAR=new Set(['WEAR_JACKET','WEAR_PANTS']);

/** Size-string shape only, to expose cross-source format drift (e.g. "150" vs "150 cm"). */
export function sizeFormat(size:string|null){
 if(size===null)return 'UNMAPPED';
 if(/^\d{1,3}(?:\.\d)?\s*cm$/i.test(size))return 'CENTIMETRES';
 if(/^\d{1,2}\/\d{1,2}\.5$/.test(size))return 'SHARED_N_N5';
 if(/^\d{1,3}(?:\.\d)?$/.test(size))return 'BARE_NUMBER';
 if(/^(?:XS|S|M|L|XL|2XL|3XL)$/.test(size))return 'WEAR_LETTER';
 return 'OTHER';
}
export function provisionalActivationReport(sources:Record<string,Payload>,catalog:CatalogVariant[]|null){
 const buckets=Object.entries(sources).flatMap(([source,p])=>p.buckets.map(b=>{
  const mapped=b.bookingSize!==null;
  const matches=catalog&&mapped?catalog.filter(v=>v.family===b.family&&v.age===b.age&&v.size===b.bookingSize&&v.tier!=='PREMIUM'):[];
  const guestParsable=WEAR.has(b.family)||matches.some(v=>centimetres(v.size)!==null);
  const reason=!mapped?'SIZE_UNMAPPED':catalog===null?'CATALOG_NOT_PROVIDED':!matches.length?'NO_EXACT_CATALOG_VARIANT':!guestParsable?'VARIANT_NOT_GUEST_RECOMMENDABLE':null;
  return {source,family:b.family,age:b.age,sourceSize:b.sourceSize,bookingSize:b.bookingSize,sizeFormat:sizeFormat(b.bookingSize),registeredQuantity:b.quantity,mappedQuantity:mapped?b.quantity:0,requestableQuantity:reason?0:b.quantity,reason};
 }));
 const sum=(rows:typeof buckets,k:'registeredQuantity'|'mappedQuantity'|'requestableQuantity')=>rows.reduce((n,r)=>n+r[k],0);
 const groups=[...new Set(buckets.map(b=>b.family+'/'+b.age))].sort().map(g=>{const rows=buckets.filter(b=>b.family+'/'+b.age===g),formats=Object.fromEntries(Object.keys(sources).map(s=>[s,[...new Set(rows.filter(r=>r.source===s).map(r=>r.sizeFormat))].sort()]));
  const drift=new Set(Object.values(formats).filter(f=>f.length).map(f=>f.join('+'))).size>1;
  return {group:g,registeredQuantity:sum(rows,'registeredQuantity'),mappedQuantity:sum(rows,'mappedQuantity'),requestableQuantity:sum(rows,'requestableQuantity'),sizeFormatsBySource:formats,crossSourceFormatDrift:drift};
 });
 return {
  classification:'PROVISIONAL_ACTIVATION_PREREGISTRATION_REPORT',writes:0,catalog:catalog===null?'NOT_PROVIDED':{variants:catalog.length},
  sources:Object.fromEntries(Object.entries(sources).map(([s,p])=>[s,{sourceSha256:p.sourceSha256,buckets:p.buckets.length}])),
  totals:{registeredQuantity:sum(buckets,'registeredQuantity'),mappedQuantity:sum(buckets,'mappedQuantity'),requestableQuantity:sum(buckets,'requestableQuantity')},
  groups,
  notRequestable:buckets.filter(b=>b.reason).map(({source,family,age,sourceSize,bookingSize,registeredQuantity,reason})=>({source,family,age,sourceSize,bookingSize,registeredQuantity,reason})),
 };
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);
 if(!(args.length===0||args.length===2&&args[0]==='--catalog'))throw new Error('USAGE: provisional-activation-report.ts [--catalog <variants.json>]');
 const dir='docs/execution/provisional-booking-capacity/',load=(f:string)=>JSON.parse(readFileSync(f,'utf8'));
 const catalog=args[0]==='--catalog'?load(args[1]!) as CatalogVariant[]:null;
 console.log(JSON.stringify(provisionalActivationReport({A:load(dir+'ACTIVATION_PAYLOAD_SOURCE_A.json'),B:load(dir+'ACTIVATION_PAYLOAD_SOURCE_B.json')},catalog),null,1));
}
