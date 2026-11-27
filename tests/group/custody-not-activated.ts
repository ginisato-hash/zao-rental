import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {groupFixture,skiMember} from './fixture';
import {CustodyService} from '../../packages/core/src/rental/custody-service';
import {provisionCustodyRole} from '../../scripts/custody-roles';
import {provisionOperationsRole} from '../../scripts/operations-roles';
import {OperationsContext} from '../../packages/core/src/operations/context';
import {CalendarService} from '../../packages/core/src/operations/calendar-service';
import {custodyHandler} from '../../apps/web/src/lib/custody-http';
import {loadStaff} from '../../packages/auth/src/staff-auth';
import {groupCustodyLinkActive} from '../../packages/core/src/group/custody-link';
import {custodyLinkAbsentProof,custodyLinkAppliedProof,groupCommittedProof,CUSTODY_LINK_OPERATIONS_GRANTS} from '../../scripts/production-group-delta';
import {syntheticPreparation} from '../custody/preparation-fixture';
import type {GroupMemberInput} from '../../packages/contracts/src/group-order';

// Production runs on 0064 (group order core) ALONE until a privileged path exists for 0065 (the custody link). Run with ZAO_TEST_CUSTODY_LINK=0 (npm run test:group-core-only).
// Isolated real PostgreSQL, synthetic data only. Proves, on the schema Production will actually have:
//  * every group loan / return / preparation entry (service and HTTP) closes with GROUP_CUSTODY_NOT_ACTIVATED, detected from the database itself;
//  * ordinary booking custody (returns, batches) and the calendar are untouched, and group holds stay protected from every custody stage move;
//  * a group can still be decided (approved / cancelled) with no loan column in the schema;
//  * applying 0065 later (privileged simulation) activates group custody WITHOUT a restart, and a group loan then works end to end.
if(process.env.ZAO_TEST_CUSTODY_LINK!=='0')throw new Error('RUN_WITH_ZAO_TEST_CUSTODY_LINK_0');
let stage='setup',count=0;const x=await groupFixture(60);const q=(s:string,p:unknown[]=[])=>x.db.pool.query(s,p);
const role=await provisionCustodyRole(x.db.pool,x.db.identity),opsRole=await provisionOperationsRole(x.db.pool,x.db.identity);
const svc=new CustodyService(role.custodyPool,x.roles.authPool,x.signed.identity);
async function check(name:string,f:()=>Promise<void>){stage=name;await f();count++;console.log('PASS '+name);}
const NOT_ACTIVATED=(e:unknown)=>(e as {code?:string}).code==='GROUP_CUSTODY_NOT_ACTIVATED'&&(e as {status?:number}).status===409||(console.error('expected GROUP_CUSTODY_NOT_ACTIVATED got',e),false);
const DAY1='2035-02-10T10:00:00+09:00';
const profile={heightCm:170,footCm:25.5,adultAtStart:true,tier:'REGULAR',ski:{weightKg:60,ageAtStart:30,skierType:'TYPE_I'},synthetic:true};
const member=(label:string):GroupMemberInput=>({...skiMember(label),profile});
async function build(token:string,members:GroupMemberInput[],label:string,confirm=true){
 const a=await x.start(token,label);const m=await x.svc.saveMembers(a.owner,a.groupId,a.revision,members);
 const qt=await x.svc.quote(a.owner,a.groupId,m.revision);await x.svc.consent(a.owner,a.groupId,{quoteId:qt.quoteId,digest:qt.digest,termsVersion:'SYNTHETIC-T1',termsSha256:'a'.repeat(64),explanationConfirmed:true});
 const s=await x.svc.submit(a.owner,a.groupId,{requestKey:randomUUID(),expectedRevision:qt.revision,quoteId:qt.quoteId});
 let revision=s.revision;if(confirm)revision=(await x.svc.confirm(x.admin,a.groupId,{requestKey:randomUUID(),expectedRevision:s.revision,fitAcknowledgedMemberIds:[]})).revision;
 return {...a,revision};
}
const part=async(groupId:string)=>(await q('SELECT * FROM group_order_parts WHERE group_id=$1 AND part_no=1 AND active',[groupId])).rows[0];
async function custodySql(sql:string,values:unknown[]=[]){
 const c=await role.custodyPool.connect();
 try{await c.query('BEGIN');await c.query("SELECT set_config('zao.actor',$1,true),set_config('zao.session',$2,true),set_config('zao.reason','Synthetic group custody test',true)",[x.signed.identity.subject,x.signed.identity.sessionId]);
  let err:unknown;try{await c.query(sql,values);}catch(e){err=e;}await c.query('ROLLBACK');return err as {code?:string;message:string}|undefined;}
 finally{c.release();}
}
try{
 const token=await x.entrance();
 const G=await build(token,[member('a1'),member('a2')],'SYNTHETIC confirmed, link absent');
 const CANC=await build(token,[member('c1')],'SYNTHETIC cancelled while the link is absent');
 await x.clock(DAY1);

 await check('the schema is the Production one: 0064 registered, 0065 not, no loan column, the ordinary loan trigger unconditional; activation reads false from the database',async()=>{
  assert.deepEqual((await q("SELECT id FROM foundation_migrations WHERE id IN ('0064','0065') ORDER BY id")).rows,[{id:'0064'}]);
  await custodyLinkAbsentProof(x.db.pool);await groupCommittedProof(x.db.pool,x.db.identity.database,(await q('SELECT current_user u')).rows[0].u);
  assert.equal(await groupCustodyLinkActive(x.db.pool),false);assert.equal(await groupCustodyLinkActive(role.custodyPool),false);
  // A partial link is never "activated": the column alone does not open anything.
  const c=await x.db.pool.connect();try{await c.query('BEGIN');await c.query('ALTER TABLE rental_loan_items ADD COLUMN group_part_id uuid');assert.equal(await groupCustodyLinkActive(c),false);}finally{await c.query('ROLLBACK');c.release();}
 });

 await check('every group custody entry of the service closes with GROUP_CUSTODY_NOT_ACTIVATED (409), before any group table is read',async()=>{
  const p=await part(G.groupId);
  await assert.rejects(svc.groupOverview(G.groupId),NOT_ACTIVATED);
  await assert.rejects(svc.groupByNumber((await q('SELECT group_number n FROM group_orders WHERE id=$1',[G.groupId])).rows[0].n),NOT_ACTIVATED);
  await assert.rejects(svc.groupCheckoutView(p.id),NOT_ACTIVATED);
  await assert.rejects(svc.groupPrepare(randomUUID(),{partId:p.id,expectedGroupRevision:1,expectedHoldVersion:1,selections:[],fitEvidence:{},manualFit:[]}),NOT_ACTIVATED);
  await assert.rejects(svc.groupCheckout(randomUUID(),{partId:p.id,expectedPreparationVersion:1}),NOT_ACTIVATED);
  assert.equal((await q('SELECT count(*)::int n FROM rental_loan_items')).rows[0].n,0);
 });

 await check('the HTTP layer answers the same way (409 + the fixed code), reads and writes alike; the staff panel maps the code to a plain message',async()=>{
  const origin='http://127.0.0.1:34567',principal=(await loadStaff(x.db.pool,x.signed.identity.subject))!,p=await part(G.groupId);
  const state=async()=>({status:'authorized' as const,principal,stamp:JSON.stringify([x.signed.identity.sessionId,'x'])});
  const handler=custodyHandler(state as never,id=>new CustodyService(role.custodyPool,x.roles.authPool,id),origin,'ISOLATED_TEST');
  const num=(await q('SELECT group_number FROM group_orders WHERE id=$1',[G.groupId])).rows[0].group_number as string;
  for(const path of ['/group-number/'+num,'/group/'+G.groupId,'/group-part/'+p.id]){const r=await handler(new Request(origin+'/api/custody'+path));assert.equal(r.status,409,path);assert.deepEqual(await r.json(),{error:'GROUP_CUSTODY_NOT_ACTIVATED'});}
  for(const [path,input] of [['/group-prepare',{partId:p.id,expectedGroupRevision:1,expectedHoldVersion:1,selections:[],fitEvidence:{},manualFit:[]}],['/group-checkout',{partId:p.id,expectedPreparationVersion:1}]] as const){
   const r=await handler(new Request(origin+'/api/custody'+path,{method:'POST',headers:{'content-type':'application/json',origin},body:JSON.stringify({requestKey:randomUUID(),input})}));assert.equal(r.status,409,path);assert.deepEqual(await r.json(),{error:'GROUP_CUSTODY_NOT_ACTIVATED'});
  }
  const panel=readFileSync(resolve('apps/web/src/components/GroupCustodyPanel.tsx'),'utf8');
  assert.ok(panel.includes("code==='GROUP_CUSTODY_NOT_ACTIVATED'"));
 });

 await check('ordinary custody is untouched: the return list and batches read without any group column, and the calendar reads group-free loans and shows a held group as a plain bar',async()=>{
  const r=await svc.returns('MOUNTAIN_BASE');assert.deepEqual(r.received,[]);
  const b=await svc.createBatch(randomUUID(),'MOUNTAIN_BASE');assert.deepEqual(b.candidates,[]);assert.equal((await svc.getBatch(b.id)).id,b.id);
  const cal=new CalendarService(new OperationsContext(opsRole.operationsPool,x.roles.authPool,x.signed.identity));
  const first=await cal.view({store:'MOUNTAIN_BASE',from:'2035-02-10',days:7,pageSize:100}),all=[...first.items];
  for(let page=2;page<=Math.ceil(first.total/100);page++)all.push(...(await cal.view({store:'MOUNTAIN_BASE',from:'2035-02-10',days:7,pageSize:100,page})).items);
  const bars=all.flatMap(i=>i.bars);assert.ok(bars.length>0,'the group protection is visible as occupancy');assert.equal(bars.filter(b=>b.kind==='OUT'||b.kind==='OVERDUE'||b.kind==='RETURNED').length,0,'no loan bar exists: nothing is out');
 });

 await check('group holds stay protected from every custody stage move, but a custody session may still flag transfer_attention (what the ordinary return does to other promises)',async()=>{
  const p=await part(G.groupId),hold=p.hold_id as string;
  for(const to of ['PREPARATION_FIXED','RENTAL_FIXED','PROVISIONAL']){
   const e=await custodySql("UPDATE inventory_holds SET allocation_stage=$2,version=version+1 WHERE id=$1",[hold,to]);assert.ok(e&&/GROUP_HOLD_PROTECTED/.test(e.message),to+': '+String(e?.message));
  }
  assert.equal((await q('SELECT allocation_stage FROM inventory_holds WHERE id=$1',[hold])).rows[0].allocation_stage,'GROUP_RESERVED');
  // The guard function itself, as a custody session evaluates it: flag-only changes pass, any stage change does not (0064 carries no stage edge).
  const c=await role.custodyPool.connect();
  try{
   const r=(await c.query(`SELECT group_custody_hold_update(h,jsonb_populate_record(h,'{"transfer_attention":"CUSTODY_RECONCILIATION_REQUIRED"}'::jsonb)) flag,
     group_custody_hold_update(h,jsonb_populate_record(h,'{"allocation_stage":"PREPARATION_FIXED"}'::jsonb)) edge FROM inventory_holds h WHERE h.id=$1`,[hold])).rows[0];
   assert.deepEqual(r,{flag:true,edge:false});
  }finally{c.release();}
 });

 await check('a group is still decided without any loan column: formal cancellation of a confirmed group works and releases its protection',async()=>{
  const c=await x.svc.cancelConfirmed(x.admin,CANC.groupId,{requestKey:randomUUID(),expectedRevision:CANC.revision,reason:'SYNTHETIC cancel with the link absent'});
  assert.equal(c.status,'CANCELLED');
  assert.equal((await q("SELECT count(*)::int n FROM inventory_claims c JOIN group_order_parts p ON p.hold_id=c.hold_id WHERE p.group_id=$1 AND c.active",[CANC.groupId])).rows[0].n,0);
 });

 await check('FORWARD: applying 0065 later (privileged simulation) activates group custody without a restart; a group loan then works end to end',async()=>{
  const file='0065_group_custody_link.sql',sql=readFileSync(resolve('packages/db/migrations',file),'utf8');
  const c=await x.db.pool.connect();
  try{await c.query('BEGIN');await c.query(sql);await c.query('INSERT INTO foundation_migrations(id,checksum) VALUES($1,$2)',['0065',createHash('sha256').update(sql).digest('hex')]);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  const owner=(await q('SELECT current_user u')).rows[0].u as string;
  await custodyLinkAppliedProof(x.db.pool,x.db.identity.database,owner);
  // the privileges the link needs (the part the privileged path must also provide), for the custody role of this fixture
  for(const s of CUSTODY_LINK_OPERATIONS_GRANTS)await q(s.replace('{OPS}',x.db.identity.namespace+'_custody'));
  assert.equal(await groupCustodyLinkActive(role.custodyPool),true,'the same connection pool sees the link at once');
  const p=await part(G.groupId);const v=await svc.groupCheckoutView(p.id);
  assert.equal(v.kind,'GROUP_PART');
  const ev=syntheticPreparation(v);
  const prepared=await svc.groupPrepare(randomUUID(),{partId:p.id,expectedGroupRevision:v.groupRevision,expectedHoldVersion:v.holdVersion,selections:v.items.map(i=>({requirementKey:i.requirement_key,assetId:i.asset_id,poleId:i.pole_id})),fitEvidence:ev,manualFit:[]});
  assert.equal(prepared.holdStage,'PREPARATION_FIXED');
  const out=await svc.groupCheckout(randomUUID(),{partId:p.id,expectedPreparationVersion:prepared.preparation.version});
  assert.equal(out.holdStage,'RENTAL_FIXED');assert.ok(out.loans.length>0&&out.loans.every((l:{state:string})=>l.state==='OUT'));
 });
 console.log('PASS group-custody-not-activated '+count+' checks');
}catch(e){console.error('GROUP_CUSTODY_NOT_ACTIVATED_FAILED '+stage);throw e;}finally{await opsRole.close().catch(()=>{});await role.close().catch(()=>{});await x.close();}
