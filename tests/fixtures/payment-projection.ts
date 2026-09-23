import {flowHash,type PaymentObservation} from '../../packages/contracts/src/rental-flow';
import {normalizePeriod,type HoldConditions} from '../../packages/contracts/src/hold';
import type {ProjectionSource,ProjectionState,ProjectionReference} from '../../packages/core/src/payment/payment-projection';
import type {InboxConnection} from '../../packages/db/src/square-webhook-inbox';
export const id=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
export const clock=new Date('2035-01-01T00:00:00Z');
export function stateFixture():ProjectionState{
 const conditions:HoldConditions={contractVersion:'INTEGRATED_V1_2',reservationId:id(1),pickupStore:'MOUNTAIN_BASE',returnStore:'ONSEN_BASE',period:{startDate:'2035-01-01',endDate:'2035-01-01',slot:'DAY'},members:[{key:'one',product:'SINGLE',age:'ADULT',tier:'REGULAR',wear:true,items:[{family:'SKI',variantIds:[id(6)]},{family:'WEAR_JACKET',variantIds:[id(7)]},{family:'WEAR_PANTS',variantIds:[id(8)]}]}]};
 const snapshot={conditions,totalJpy:100,currency:'JPY',chargeReady:false,advanceDiscountJpy:0};
 return {booking:{id:id(1),ownerId:'synthetic-actor',holdId:id(2),quoteId:id(3),mode:'SQUARE_SANDBOX',state:'PAYMENT_PENDING',confirmedAt:null,version:2,conditions,priceSnapshot:snapshot,priceHash:flowHash(snapshot)},
 attempt:{expected:{attemptId:id(4),bookingId:id(1),idempotencyKey:id(5),merchantId:'fixture-merchant',locationId:'fixture-location',amountJpy:100,currency:'JPY'},actor:'synthetic-actor',state:'PENDING',providerId:'fixture-payment',providerState:null,providerUpdatedAt:null,completedAt:null},
 hold:{id:id(2),ownerId:'synthetic-actor',reservationId:id(1),state:'ACTIVE',paymentState:'PENDING',allocationStage:'PROVISIONAL',transferAttention:null,expiresAt:new Date(clock.getTime()+600000).toISOString(),dueAt:normalizePeriod(conditions.period).dueAt,confirmedAt:null,version:2,conditions},
 quote:{id:id(3),actor:'synthetic-actor',holdId:id(2),conditions,snapshot,snapshotHash:flowHash(snapshot),couponId:null},gearClaimsIntact:true,wearClaimsIntact:true,forbiddenTransfer:false,unreadyTransferAt:null,revision:0,previous:null};
}
export function observation(status:PaymentObservation['status']='COMPLETED'):PaymentObservation{const e=stateFixture().attempt.expected;return {providerId:'fixture-payment',referenceId:e.bookingId,idempotencyKey:e.idempotencyKey,merchantId:e.merchantId,locationId:e.locationId,amountJpy:100,currency:'JPY',status,updatedAt:clock.toISOString(),completedAt:status==='COMPLETED'?clock.toISOString():null};}
export function sourceFixture(o=observation()):ProjectionSource{const contextFingerprint=flowHash('synthetic-context'),decision='ACCEPT_'+o.status;return {jobId:id(9),environment:'SANDBOX',merchantId:o.merchantId,paymentId:o.providerId,state:o.status==='PENDING'?'RETRY_WAIT':'RECONCILED',securityBlocked:false,truthRevision:1,decision,contextFingerprint,decisionFingerprint:flowHash({engine:'payment-truth-v1',contextFingerprint,paymentId:o.providerId,decision,observation:o}),observation:o};}
export function reference(source=sourceFixture(),expectedRevision=0):ProjectionReference{return {bookingId:id(1),attemptId:id(4),jobId:source.jobId,truthRevision:source.truthRevision,truthFingerprint:source.decisionFingerprint,observationFingerprint:flowHash(source.observation),expectedRevision};}
export function claimFixture(s=stateFixture()){return s.booking.conditions.members.flatMap(m=>m.items.flatMap(i=>normalizePeriod(s.booking.conditions.period).dates.map(day=>({requirement_key:m.key+':'+i.family,day,kind:i.family.startsWith('WEAR')?'WEAR':'GEAR',quantity:1,id:i.variantIds[0],family:i.family,age:m.age,tier:i.family.startsWith('WEAR')?'STANDARD':m.tier,model_id:id(40),catalog_season:'2034/35',compatible_sports:['SKI','SNOWBOARD']}))));}
function worldFixture(){
 const s=stateFixture(),b=s.booking,a=s.attempt,h=s.hold!,q=s.quote!,src=sourceFixture();return {
  b:{id:b.id,owner_id:b.ownerId,hold_id:b.holdId,quote_id:b.quoteId,mode:b.mode,state:b.state,confirmed_at:b.confirmedAt,version:b.version,conditions:b.conditions,price_snapshot:b.priceSnapshot,price_sha256:b.priceHash,contact:{displayName:'SYNTHETIC Fixture',email:'synthetic-fixture@example.invalid',termsAccepted:true}},
  a:{id:a.expected.attemptId,booking_id:a.expected.bookingId,actor:a.actor,idempotency_key:a.expected.idempotencyKey,merchant_id:a.expected.merchantId,location_id:a.expected.locationId,amount_jpy:'100',currency:'JPY',state:a.state,provider_id:a.providerId,provider_state:a.providerState,provider_updated_at:a.providerUpdatedAt,completed_at:a.completedAt},
  h:{id:h.id,owner_id:h.ownerId,reservation_id:h.reservationId,state:h.state,payment_state:h.paymentState,allocation_stage:h.allocationStage,transfer_attention:h.transferAttention,expires_at:new Date(h.expiresAt),due_at:new Date(h.dueAt),confirmed_at:null as Date|null,version:h.version,conditions:h.conditions},
  q:{id:q.id,actor:q.actor,hold_id:q.holdId,conditions:q.conditions,snapshot:q.snapshot,snapshot_sha256:q.snapshotHash,coupon_id:null,hold_version:2,expires_at:new Date(clock.getTime()+600000)},
  src,claims:claimFixture(s),transfer:{forbidden:false,unready_at:null as string|null},head:null as null|{revision:number;last_observation:PaymentObservation|null},
  events:[] as Record<string,unknown>[],receipts:[] as unknown[][],history:[] as string[],providerEvents:[] as {event_id:string;attempt_id:string;payload_sha256:string;outcome:string}[],notifications:[] as unknown[][],
 };
}
export type ProjectionWorld=ReturnType<typeof worldFixture>;
/** Scripted SQL/transaction model, not a PostgreSQL lock, isolation, trigger, durability or privilege proof. */
export class ProjectionSqlFixture{
 world=worldFixture();now=new Date(clock);calls:{sql:string;values:unknown[];connection:number}[]=[];released:boolean[]=[];
 failAt:string|null=null;loseCommitResponse=false;staleHeadWrite=false;database='zr_012345abcdef';role='zr_012345abcdef_pay_projection';
 onQuery:((sql:string)=>Promise<void>)|null=null;private chain=Promise.resolve();private serial=0;
 async lock(){const previous=this.chain;let unlock=()=>{};this.chain=new Promise<void>(r=>{unlock=r;});await previous;return unlock;}
 async connect():Promise<InboxConnection>{
  const number=++this.serial;let tx:ProjectionWorld|null=null,unlock:(()=>void)|null=null,committed=false;
  const query=async(sql:string,values:unknown[]=[])=>{
   this.calls.push({sql,values,connection:number});if(this.onQuery)await this.onQuery(sql);
   if(this.failAt&&sql.includes(this.failAt))throw new Error('SYNTHETIC_PRIVATE_FAILURE');
   if(sql.startsWith('BEGIN'))return {rows:[],rowCount:0};
   if(sql==='SELECT pg_advisory_xact_lock(71820600)'){unlock=await this.lock();tx=structuredClone(this.world);return {rows:[],rowCount:1};}
   if(sql==='COMMIT'){if(tx)this.world=tx;committed=true;unlock?.();unlock=null;if(this.loseCommitResponse){this.loseCommitResponse=false;throw new Error('SYNTHETIC_LOST_COMMIT_RESPONSE');}return {rows:[],rowCount:0};}
   if(sql==='ROLLBACK'){tx=null;unlock?.();unlock=null;return {rows:[],rowCount:0};}
   const w=tx??this.world,v=values;let rows:unknown[]=[],count=0;
   if(sql.startsWith('SET ')||sql.includes("set_config('zao.actor'")||sql.includes('pg_advisory_xact_lock_shared'))return {rows,rowCount:count};
   if(sql.includes('current_database()'))rows=[{name:this.database,role:this.role}];
   else if(sql.startsWith('SELECT inventory_clock()'))rows=[{now:new Date(this.now)}];
   else if(sql.startsWith('SELECT')&&sql.includes('FROM rental_bookings'))rows=sql.includes('WHERE owner_id=$1 AND request_key=$2')?[]:(w.b&&String(v[0])===w.b.id||sql.includes('ORDER BY created_at')?[w.b]:[]);
   else if(sql.startsWith('SELECT')&&sql.includes('FROM rental_payment_attempts'))rows=w.a&&(String(v[0])===w.a.id||String(v[0])===w.a.booking_id)&&(!v[1]||v[1]===w.a.booking_id)?[w.a]:[];
   else if(sql.startsWith('SELECT')&&sql.includes('FROM inventory_holds'))rows=w.h?[w.h]:[];
   else if(sql.startsWith('SELECT')&&sql.includes('FROM price_quotes'))rows=[w.q];
   else if(sql.startsWith('SELECT')&&sql.includes('FROM payment_projection.heads'))rows=w.head?[w.head]:[];
   else if(sql.startsWith('SELECT')&&sql.includes('FROM payment_projection.events'))rows=w.events.filter(e=>e.observation_fingerprint===v[2]).map(e=>({result:e.result,jobId:e.job_id,truthFingerprint:e.truth_fingerprint}));
   else if(sql.startsWith('SELECT')&&sql.includes('FROM payment_reconciliation.streams'))rows=[{truth_revision:w.src.truthRevision,latest:w.src.observation}];
   else if(sql.startsWith('SELECT')&&sql.includes('FROM payment_reconciliation.jobs'))rows=[{id:w.src.jobId,environment:w.src.environment,merchant_id:w.src.merchantId,payment_id:w.src.paymentId,state:w.src.state,security_blocked:w.src.securityBlocked,decision:w.src.decision,decision_fingerprint:w.src.decisionFingerprint,context_fingerprint:w.src.contextFingerprint}];
   else if(sql.includes('booking_cancellation_status'))rows=[{v:null}];
   else if(sql.includes('bool_or'))rows=[w.transfer];
   else if(sql.startsWith('SELECT 1 FROM inventory_claims'))rows=w.transfer.forbidden?[{found:1}]:[];
   else if(sql.startsWith('SELECT')&&sql.includes('FROM inventory_claims'))rows=w.claims;
   else if(sql.startsWith('SELECT')&&sql.includes('FROM rental_provider_events'))rows=w.providerEvents.filter(e=>e.event_id===v[0]);
   else if(sql.startsWith('SELECT')&&sql.includes('FROM rental_history'))rows=w.history.map(event=>({event,actor:'synthetic-actor',occurred_at:this.now}));
   else if(sql.startsWith('INSERT INTO payment_projection.heads')){if(this.staleHeadWrite)return {rows:[],rowCount:0};w.head={revision:Number(v[1]),last_observation:v[3]?JSON.parse(String(v[3])):w.head?.last_observation??null};count=1;}
   else if(sql.startsWith('INSERT INTO payment_projection.events')){if(w.events.some(e=>e.observation_fingerprint===v[5]))throw new Error('unique violation');w.events.push({booking_id:v[0],attempt_id:v[1],job_id:v[2],truth_fingerprint:v[6],observation_fingerprint:v[5],result:JSON.parse(String(v[14]))});count=1;}
   else if(sql.startsWith('INSERT INTO payment_projection.job_receipts')){if(!w.receipts.some(e=>e[0]===v[0]&&e[1]===v[1]&&e[2]===v[2]))w.receipts.push(v);count=1;}
   else if(sql.startsWith('INSERT INTO rental_bookings')){w.b=Object.assign(w.b??{},{id:v[0],owner_id:v[1],request_key:v[2],fingerprint:v[3],hold_id:v[4],quote_id:v[5],conditions:JSON.parse(String(v[6])),price_snapshot:JSON.parse(String(v[7])),price_sha256:v[8],contact:JSON.parse(String(v[9])),mode:v[10],state:'DRAFT',confirmed_at:null,version:1});count=1;}
   else if(sql.startsWith('INSERT INTO rental_payment_attempts')){w.a={id:String(v[0]),booking_id:String(v[1]),actor:String(v[2]),idempotency_key:String(v[3]),merchant_id:String(v[4]),location_id:String(v[5]),amount_jpy:String(v[6]),currency:'JPY',state:'SUBMITTING',provider_id:null,provider_state:null,provider_updated_at:null,completed_at:null};w.history.push('attempt-create');count=1;}
   else if(sql.startsWith("UPDATE rental_payment_attempts SET state='UNKNOWN'")){if(w.a.state==='SUBMITTING'){w.a.state='UNKNOWN';w.history.push('attempt-unknown');count=1;}}
   else if(sql.startsWith('UPDATE rental_payment_attempts SET state=$2')){Object.assign(w.a,{state:v[1],provider_id:v[2],provider_state:v[3],provider_updated_at:v[4],completed_at:v[5]});w.history.push('attempt');count=1;}
   else if(sql.startsWith('UPDATE rental_bookings')){w.b.state=sql.includes('state=$3')?String(v[2]):sql.includes("state='CONFIRMED_DEV'")?'CONFIRMED_DEV':sql.includes("state='PAYMENT_PENDING'")?'PAYMENT_PENDING':'PAYMENT_REVIEW';w.b.version++;if(['CONFIRMED_DEV','CONFIRMED'].includes(w.b.state))w.b.confirmed_at=(v[1] as Date).toISOString();w.history.push('booking');count=1;}
   else if(sql.startsWith('UPDATE inventory_holds')){if(sql.includes('expires_at>inventory_clock()')&&(w.h.expires_at<=this.now||w.h.due_at<=this.now))return {rows:[],rowCount:0};w.h.payment_state=sql.includes("payment_state='SUCCESS'")?'SUCCESS':sql.includes("payment_state='UNKNOWN'")?'UNKNOWN':sql.includes("payment_state='PENDING'")?'PENDING':String(v[1]);w.h.version++;if(w.h.payment_state==='SUCCESS')w.h.confirmed_at=v[1] as Date;w.history.push('hold');count=1;}
   else if(sql.startsWith('INSERT INTO rental_provider_events')){w.providerEvents.push({event_id:String(v[0]),attempt_id:String(v[1]),payload_sha256:String(v[2]),outcome:String(v[3])});count=1;}
   else if(sql.startsWith('INSERT INTO rental_notifications')){w.notifications.push(v);count=1;}
   else throw new Error('UNSCRIPTED_SQL:'+sql);
   return {rows,rowCount:count||rows.length};
  };
  return {query,release:(broken?:boolean)=>{if(!committed)unlock?.();this.released.push(!!broken);}} as unknown as InboxConnection;
 }
 async query(sql:string,values:unknown[]=[]){const c=await this.connect();try{return await c.query(sql,values);}finally{c.release();}}
}
