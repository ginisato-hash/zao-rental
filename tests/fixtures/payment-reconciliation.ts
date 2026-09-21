// Pure shared-memory model, NOT PostgreSQL durability/locking evidence. No runtime imports this file.
import {randomUUID} from 'node:crypto';
import type {InboxSignal,SquareWebhookInbox,WebhookEnvironment} from '../../packages/core/src/payment/square-webhook-inbox';
import type {PaymentReconciliationRepository,ReconciliationClaim,JobOutcome,JobSummary} from '../../packages/core/src/payment/payment-reconciliation';
import type {PaymentObservation} from '../../packages/contracts/src/rental-flow';
type Job=ReconciliationClaim&{state:string;terminal:boolean;due:number;signal:number;claimed:number;code:string|null;decision:string|null;security:boolean;};
export class ReconciliationFixture implements PaymentReconciliationRepository,SquareWebhookInbox{
 time=Date.parse('2035-01-01T00:00:00Z');readonly inbox=new Map<string,InboxSignal>();readonly links=new Map<string,string>();readonly jobs=new Map<string,Job>();readonly truth=new Map<string,{revision:number;latest:PaymentObservation|null}>();readonly audit:unknown[]=[];readonly stops=new Map<string,string>();readonly conflicts=new Set<string>();
 failDispatch=false;failFinalize=false;loseFinalizeResponse=false;
 now=()=>new Date(this.time);advance(seconds:number){this.time+=seconds*1000;}
 private key(s:Pick<InboxSignal,'environment'|'merchantId'|'paymentId'>){return [s.environment,s.merchantId,s.paymentId].join('/');}
 async receive(s:InboxSignal){const k=s.environment+'/'+s.eventId,old=this.inbox.get(k);if(old){if(old.bodySha256===s.bodySha256)return 'DUPLICATE' as const;this.conflicts.add(k);const job=this.jobs.get(this.links.get(k)??'');if(job){job.security=true;if(!job.terminal){job.state='BLOCKED';job.terminal=true;}job.code='EVIDENCE_MISMATCH_BLOCKED';}return 'HASH_CONFLICT' as const;}this.inbox.set(k,{...s});return 'INSERTED' as const;}
 async dispatch(environment:WebhookEnvironment,limit:number){
  const source=[...this.inbox].filter(([k,s])=>s.environment===environment&&!this.links.has(k)&&!this.conflicts.has(k)).slice(0,limit);
  // Failure injected at the transaction boundary: no marker/link/job becomes visible.
  if(this.failDispatch)throw new Error('RECONCILIATION_STORAGE_UNAVAILABLE');
  for(const [eventKey,s] of source){const key=this.key(s);const jobs=[...this.jobs.values()].filter(j=>this.key(j)===key).sort((a,b)=>b.generation-a.generation);let j=jobs[0];
   if(!j||j.state==='RECONCILED'&&!j.security){const id=randomUUID();j={id,...s,generation:(j?.generation??0)+1,sourceEventId:s.eventId,sourceFingerprint:s.bodySha256,signalRevision:1,truthRevision:0,attempt:0,leaseOwner:'',leaseToken:'',leaseExpiresAt:new Date(0),deadlineAt:new Date(this.time+86400000),latest:null,state:'READY',terminal:false,due:this.time,signal:1,claimed:0,code:null,decision:null,security:false};this.jobs.set(id,j);const stop=this.stops.get(s.environment+'/'+s.merchantId);if(stop){j.state='BLOCKED';j.code=stop;j.terminal=true;}}
   else j.signal++;
   this.links.set(eventKey,j.id);if(!this.truth.has(key))this.truth.set(key,{revision:0,latest:null});
  }return source.length;
 }
 async claimBatch(environment:WebhookEnvironment,workerId:string,limit:number){const claimed:ReconciliationClaim[]=[];
  for(const j of this.jobs.values()){if(claimed.length>=limit)break;if(j.environment!==environment||!['READY','RETRY_WAIT','CLAIMED'].includes(j.state)||j.due>this.time||j.security)continue;
   const stop=this.stops.get(j.environment+'/'+j.merchantId);if(stop){j.state='BLOCKED';j.code=stop;j.terminal=true;continue;}
   if(j.attempt>=5||j.deadlineAt.getTime()<=this.time){j.state='DEAD';j.terminal=true;j.code=j.attempt>=5?'ATTEMPTS_EXHAUSTED':'DEADLINE_EXCEEDED';continue;}
   const truth=this.truth.get(this.key(j))!;j.attempt++;j.state='CLAIMED';j.leaseToken=randomUUID();j.leaseOwner=workerId;j.leaseExpiresAt=new Date(this.time+60000);j.due=this.time+60000;j.claimed=j.signal;j.signalRevision=j.signal;j.truthRevision=truth.revision;j.latest=truth.latest;
   claimed.push(structuredClone(j));
  }return claimed;
 }
 async finalize(c:ReconciliationClaim,o:JobOutcome){
  if(this.failFinalize)throw new Error('RECONCILIATION_STORAGE_UNAVAILABLE');const j=this.jobs.get(c.id)!,t=this.truth.get(this.key(c))!;
  if(j.state!=='CLAIMED'||j.security||j.leaseToken!==c.leaseToken||j.due<=this.time||t.revision!==c.truthRevision)return false;
  if(j.deadlineAt.getTime()<=this.time)o={state:'DEAD',code:'DEADLINE_EXCEEDED',retrySeconds:null,truth:null};
  if(o.truth?.decision.startsWith('ACCEPT_')){t.latest=structuredClone(o.truth.observation);t.revision++;}
  j.state=o.state;if(o.state==='RECONCILED'&&j.signal>j.claimed)j.state='READY';
  if(['READY','RETRY_WAIT'].includes(j.state)&&j.attempt>=5){j.state='DEAD';o={...o,code:'ATTEMPTS_EXHAUSTED'};}
  if(o.code==='AUTH_BLOCKED'||o.code==='RATE_LIMITED')this.stops.set(j.environment+'/'+j.merchantId,o.code);
  j.code=o.code;j.decision=o.truth?.decision??null;j.terminal=['DEAD','BLOCKED','RECONCILED'].includes(j.state);j.due=Math.min(this.time+(o.retrySeconds??0)*1000,j.deadlineAt.getTime());j.leaseToken='';j.leaseOwner='';j.leaseExpiresAt=new Date(0);
  this.audit.push({id:j.id,state:j.state,code:j.code,decision:j.decision,fingerprint:o.truth?.fingerprint??null});
  if(this.loseFinalizeResponse)throw new Error('RECONCILIATION_STORAGE_UNAVAILABLE');return true;
 }
 async diagnostics(environment:WebhookEnvironment,limit:number):Promise<JobSummary[]>{return [...this.jobs.values()].filter(j=>j.environment===environment&&(['BLOCKED','DEAD'].includes(j.state)||j.security)).slice(0,limit).map(j=>({id:j.id,state:j.state,generation:j.generation,paymentId:j.paymentId,attempt:j.attempt,code:j.code,decision:j.decision,updatedAt:new Date(this.time)}));}
}
