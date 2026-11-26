import {randomUUID} from 'node:crypto';
import {bootstrapDevelopmentAdmin} from '../../scripts/bootstrap-staff';
import {writeAccount} from '../../packages/auth/src/accounts';
import {loadStaff} from '../../packages/auth/src/staff-auth';
import {GroupOrderService,type OwnerActor,type StaffActor} from '../../packages/core/src/group/group-service';
import {QuoteService} from '../../packages/core/src/pricing/quote-service';
import type {GroupMemberInput} from '../../packages/contracts/src/group-order';
import type {startDevelopmentApp} from '../../scripts/development-app';
import {seedRecommendation} from '../recommendation/fixture';
import {fid,variants} from '../inventory/fixture';
import {skiMember,secret,PERIOD} from './fixture';

/** Group administrator UI/API harness over an owned development app (synthetic local PostgreSQL only). Seeds ledger stock, a price book
 * and a fixed clock inside the app's own database, then drives the group service exactly as the (separate) customer flow will. */
type App=Awaited<ReturnType<typeof startDevelopmentApp>>;
export const CLOCK='2035-01-01T10:00:00+09:00';
export async function adminHarness(app:App,password:string,stock=150){
 if(!app.group)throw new Error('GROUP_ROLE_NOT_PROVISIONED');
 const pool=app.db.pool;
 await seedRecommendation(pool,false,true);
 await pool.query(`CREATE OR REPLACE FUNCTION inventory_clock() RETURNS timestamptz LANGUAGE sql VOLATILE AS $$SELECT '${new Date(CLOCK).toISOString()}'::timestamptz$$`);
 const c=await pool.connect();
 try{await c.query('BEGIN');await c.query("SELECT set_config('zao.actor','synthetic-group-admin-seed',true),set_config('zao.reason','SYNTHETIC group stock',true)");
  for(const [family,variant,base] of [['SKI',variants.ski,20000],['SKI_BOOT',variants.boot,21000]] as const)for(let n=0;n<stock-1;n++)await c.query(`INSERT INTO ledger_assets(id,variant_id,family,initial_store_id,store_id,status,bsl_status,bsl_evidence,notes,source_kind,source_document,source_locator) VALUES($1,$2,$3,'MOUNTAIN_BASE','MOUNTAIN_BASE','AVAILABLE',$4,'','','SYNTHETIC','tests/group/admin-harness.ts',$5)`,[fid(base+n),variant,family,family==='SKI_BOOT'?'UNVERIFIED':'NOT_APPLICABLE','GROUP-'+family+'-'+n]);
  await c.query('UPDATE ledger_poles SET quantity=$1,version=version+1 WHERE id=$2',[stock,fid(1301)]);await c.query('COMMIT');
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 const root=await bootstrapDevelopmentAdmin(pool,{email:'gadm-root@example.invalid',displayName:'SYNTHETIC Group Root',password}),rootPrincipal=(await loadStaff(pool,root))!;
 // The price book is initialized by a dedicated price administrator (the bootstrap ADMIN carries no commercial permission by itself).
 const perms={BOOKING_VIEW:true,QUOTE_VIEW:true,QUOTE_CREATE:true,PRICE_EDIT:true,HOLD_VIEW:true,INVENTORY_VIEW:true};
 const priceId=(await writeAccount(app.roles.authPool,rootPrincipal,undefined,{email:'gadm-price@example.invalid',password,displayName:'SYNTHETIC Price Admin',active:true,role:'ADMIN',scope:'ALL',storeIds:[],permissions:perms} as never)).id!;
 await new QuoteService(app.roles.pricingPool,(await loadStaff(pool,priceId))!,()=>new Date(CLOCK)).initializePrivate(randomUUID(),'2035-01-01','2035-12-31');
 const account=async(email:string,input:{role?:'ADMIN'|'MANAGER'|'STAFF';scope?:'ALL'|'ASSIGNED';storeIds?:string[];permissions?:Record<string,boolean>}={})=>{
  const id=(await writeAccount(app.roles.authPool,rootPrincipal,undefined,{email,password,displayName:'SYNTHETIC '+email.split('@')[0],active:true,role:input.role??'ADMIN',scope:input.scope??'ALL',storeIds:input.storeIds??[],permissions:input.permissions??{}} as never)).id!;
  const p=(await loadStaff(pool,id))!;const actor:StaffActor={kind:'STAFF',subject:p.subject,revision:p.revision};
  /** Full-settings update (the account API replaces the whole settings object under a revision check). */
  const update=async(patch:{role?:'ADMIN'|'MANAGER';scope?:'ALL'|'ASSIGNED';storeIds?:string[];permissions?:Record<string,boolean>})=>{const cur=(await loadStaff(pool,id))!;
   return writeAccount(app.roles.authPool,rootPrincipal,id,{displayName:'SYNTHETIC '+email.split('@')[0],active:true,role:patch.role??cur.role,scope:patch.scope??cur.scope,storeIds:(patch.scope??cur.scope)==='ALL'?[]:(patch.storeIds??cur.storeIds),permissions:patch.permissions??{},expectedRevision:cur.revision} as never);};
  return {id,actor,email,update};};
 const svc=new GroupOrderService(app.group.groupPool);
 const admin=await account('gadm-admin@example.invalid');
 const entrance=async()=>(await svc.rotateEntrance(admin.actor,'SYNTHETIC test entrance')).token;
 const start=async(token:string,label:string,period:{startDate:string;endDate:string;slot:'DAY'}=PERIOD,store='MOUNTAIN_BASE')=>{
  const s=secret();const r=await svc.startApplication(token,randomUUID(),s,{groupLabel:label,contactName:'SYNTHETIC Rep',contactEmail:'synthetic-rep@example.invalid',locale:'ja',pickupStore:store,returnStore:store,contractVersion:'INTEGRATED_V1_4',period});
  const owner:OwnerActor={kind:'OWNER',groupId:r.groupId,secret:s};return {owner,groupId:r.groupId,revision:r.revision};};
 /** application -> members -> quote -> consent -> submit (all members reserved at once): a REVIEW_HELD group. */
 const held=async(token:string,label:string,members:GroupMemberInput[],period?:{startDate:string;endDate:string;slot:'DAY'},store?:string)=>{
  const a=await start(token,label,period,store);const m=await svc.saveMembers(a.owner,a.groupId,a.revision,members);const q=await svc.quote(a.owner,a.groupId,m.revision);
  await svc.consent(a.owner,a.groupId,{quoteId:q.quoteId,digest:q.digest,termsVersion:'SYNTHETIC-T1',termsSha256:'a'.repeat(64),explanationConfirmed:true});
  const s=await svc.submit(a.owner,a.groupId,{requestKey:randomUUID(),expectedRevision:q.revision,quoteId:q.quoteId});
  return {...a,revision:s.revision,memberIds:m.memberIds,quote:q};};
 /** The representative accepts the current estimate again (needed after an administrator-approved change). */
 const reconsent=async(owner:OwnerActor,groupId:string)=>{
  const q=(await pool.query<{id:string;digest:string}>("SELECT id,digest FROM group_quotes WHERE group_id=$1 AND kind='ESTIMATE' ORDER BY version DESC LIMIT 1",[groupId])).rows[0]!;
  await svc.consent(owner,groupId,{quoteId:q.id,digest:q.digest,termsVersion:'SYNTHETIC-T1',termsSha256:'a'.repeat(64),explanationConfirmed:true});};
 const members=(n:number,prefix='m',manualFit?:number[])=>Array.from({length:n},(_,i)=>{const m=skiMember(prefix+(i+1));return manualFit?.includes(i)?{...m,fit:{status:'MANUAL_FIT_REQUIRED'}}:m;});
 /** Stock for the alternative ski size (variants.skiAlt) so a size change can succeed; without it the same change must fail and keep the old hold. */
 const addAltStock=async(n:number)=>{const k=await pool.connect();try{await k.query('BEGIN');await k.query("SELECT set_config('zao.actor','synthetic-group-admin-seed',true),set_config('zao.reason','SYNTHETIC alt size stock',true)");
  for(let i=0;i<n;i++)await k.query(`INSERT INTO ledger_assets(id,variant_id,family,initial_store_id,store_id,status,bsl_status,bsl_evidence,notes,source_kind,source_document,source_locator) VALUES($1,$2,'SKI','MOUNTAIN_BASE','MOUNTAIN_BASE','AVAILABLE','NOT_APPLICABLE','','','SYNTHETIC','tests/group/admin-harness.ts',$3)`,[fid(40000+i),variants.skiAlt,'GROUP-ALT-'+i]);await k.query('COMMIT');}catch(e){await k.query('ROLLBACK');throw e;}finally{k.release();}};
 return {svc,admin,account,entrance,start,held,reconsent,members,pool,rootPrincipal,addAltStock,close:async()=>{}};
}
