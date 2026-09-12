import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import Ajv from 'ajv';
import schema from '../../packages/contracts/src/hold-input.schema.json';
import {GROUP_JSON_BYTES,DEFAULT_JSON_BYTES} from '../../packages/contracts/src/http-body-limits';
import {readJson} from '../../apps/web/src/lib/ledger-http';
test('current schema maxima plus normal HOLD/amend/quote wrappers fit finite24KiB UTF8',()=>{
 const longest=(xs:string[])=>xs.reduce((a,b)=>Buffer.byteLength(a)>Buffer.byteLength(b)?a:b);const m=schema.properties.members,ms=m.items.properties,items=ms.items.items.properties;
 const input={reservationId:randomUUID(),pickupStore:longest(schema.properties.pickupStore.enum),returnStore:longest(schema.properties.returnStore.enum),period:{startDate:'2035-12-21',endDate:'2035-12-30',slot:longest(schema.properties.period.properties.slot.enum)},members:Array.from({length:m.maxItems},(_,i)=>({key:('member-'+i).padEnd(24,'z'),product:longest(ms.product.enum),age:longest(ms.age.enum),tier:longest(ms.tier.enum),items:Array.from({length:ms.items.maxItems},()=>({family:longest(items.family.enum),variantIds:Array.from({length:items.variantIds.maxItems},()=>randomUUID())}))}))};
 assert.ok(new Ajv().compile(schema)(input));const variants=[input,{requestKey:randomUUID(),conditions:input},{requestKey:randomUUID(),conditions:input,expectedVersion:Number.MAX_VALUE},{requestKey:randomUUID(),input:{conditions:input,holdId:randomUUID(),couponCode:'C'.repeat(32),wantAdvance:false}}];const bytes=variants.map(v=>Buffer.byteLength(JSON.stringify(v)));assert.ok(Math.min(...bytes)>DEFAULT_JSON_BYTES);assert.ok(Math.max(...bytes)<=GROUP_JSON_BYTES);console.log('S01_SCHEMA_MAX_BYTES '+JSON.stringify(bytes));
});
test('readJson counts actual split UTF8 stream, ignores declared length, cancels overflow',async()=>{
 let cancelled=false,pulls=0;const stream=new ReadableStream<Uint8Array>({pull(c){pulls++;c.enqueue(new Uint8Array(4096).fill(32));},cancel(){cancelled=true;}},{highWaterMark:0});const request=new Request('http://localhost',{method:'POST',duplex:'half',headers:{'content-type':'application/json','content-length':'1'},body:stream} as RequestInit);await assert.rejects(readJson(request,GROUP_JSON_BYTES),{status:413});assert.equal(cancelled,true);assert.ok(pulls<=8);
 for(const body of [new Uint8Array([0xff]),new TextEncoder().encode('{broken')])await assert.rejects(readJson(new Request('http://localhost',{method:'POST',headers:{'content-type':'application/json'},body})),{status:422});
 const bytes=new TextEncoder().encode('{"text":"雪"}'),chunks=[bytes.slice(0,10),bytes.slice(10)];const split=new ReadableStream({pull(c){const next=chunks.shift();if(next)c.enqueue(next);else c.close();}});assert.deepEqual(await readJson(new Request('http://localhost',{method:'POST',duplex:'half',headers:{'content-type':'application/json'},body:split} as RequestInit)),{text:'雪'});
});
