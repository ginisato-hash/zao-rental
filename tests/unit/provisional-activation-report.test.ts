import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {provisionalActivationReport,sizeFormat,type Payload} from '../../scripts/provisional-activation-report';

const bucket=(family:string,age:'ADULT'|'KIDS',sourceSize:string,bookingSize:string|null,quantity:number)=>({family,age,sourceSize,bookingSize,quantity,provenance:'SYNTHETIC'});
const A:Payload={sourceSha256:'a'.repeat(64),originalFilename:'SYNTHETIC A.csv',buckets:[bucket('SNOWBOARD','ADULT','150','150',30),bucket('SKI_BOOT','KIDS','20','20',12)]};
const B:Payload={sourceSha256:'b'.repeat(64),originalFilename:'SYNTHETIC B.xlsx',buckets:[bucket('SNOWBOARD','ADULT','150 cm','150 cm',7),bucket('SKI_BOOT','ADULT','26X','26/26.5',5),bucket('SKI_BOOT','ADULT','31X','31/31.5',2),bucket('SKI','ADULT','160 cm','160 cm',4),bucket('SKI','KIDS','??',null,1)]};

test('registered, mapped and requestable quantities stay distinct; family totals are not bookable capacity',()=>{
 const r=provisionalActivationReport({A,B},[
  {family:'SNOWBOARD',age:'ADULT',size:'150 cm',tier:'REGULAR'},
  {family:'SKI_BOOT',age:'ADULT',size:'26/26.5',tier:'REGULAR'},
  {family:'SKI',age:'ADULT',size:'160 cm',tier:'PREMIUM'},
 ]);
 assert.deepEqual(r.totals,{registeredQuantity:61,mappedQuantity:60,requestableQuantity:7});assert.equal(r.writes,0);
 const reason=(source:string,size:string)=>r.notRequestable.find(x=>x.source===source&&x.sourceSize===size)?.reason;
 assert.equal(reason('A','150'),'NO_EXACT_CATALOG_VARIANT');// "150" never equals the "150 cm" variant
 assert.equal(reason('B','26X'),'VARIANT_NOT_GUEST_RECOMMENDABLE');// exact match, but the guest recommender needs "<n> cm"
 assert.equal(reason('B','31X'),'NO_EXACT_CATALOG_VARIANT');// syntactically MAPPED, no catalog variant: cannot satisfy a booking
 assert.equal(reason('B','160 cm'),'NO_EXACT_CATALOG_VARIANT');// PREMIUM variants are never provisional-eligible
 assert.equal(reason('B','??'),'SIZE_UNMAPPED');
 assert.equal(r.groups.find(g=>g.group==='SNOWBOARD/ADULT')!.crossSourceFormatDrift,true);
});
test('without a catalog nothing is requestable and the committed payloads keep their exact totals',()=>{
 const load=(s:string)=>JSON.parse(readFileSync(`docs/execution/provisional-booking-capacity/ACTIVATION_PAYLOAD_SOURCE_${s}.json`,'utf8')) as Payload;
 const r=provisionalActivationReport({A:load('A'),B:load('B')},null);
 assert.equal(r.catalog,'NOT_PROVIDED');assert.equal(r.totals.requestableQuantity,0);assert.equal(r.totals.registeredQuantity,1421);
 const family=(f:string)=>r.groups.filter(g=>g.group.startsWith(f+'/')).reduce((n,g)=>n+g.registeredQuantity,0);
 assert.deepEqual({SKI:family('SKI'),SNOWBOARD:family('SNOWBOARD'),SKI_BOOT:family('SKI_BOOT'),SNOWBOARD_BOOT:family('SNOWBOARD_BOOT'),WEAR_JACKET:family('WEAR_JACKET'),WEAR_PANTS:family('WEAR_PANTS')},{SKI:311,SNOWBOARD:260,SKI_BOOT:311,SNOWBOARD_BOOT:309,WEAR_JACKET:115,WEAR_PANTS:115});
 assert.ok(r.notRequestable.every(x=>x.reason==='CATALOG_NOT_PROVIDED'));
 // The Owner X-token rule (NX = shared N/N.5 bucket) is reported, not rewritten.
 assert.ok(load('B').buckets.some(b=>b.sourceSize==='31X'&&b.bookingSize==='31/31.5'));
 assert.deepEqual(['150 cm','26/26.5','150','XL',null,'26.5x'].map(sizeFormat),['CENTIMETRES','SHARED_N_N5','BARE_NUMBER','WEAR_LETTER','UNMAPPED','OTHER']);
});
