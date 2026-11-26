import {createHash,randomBytes,randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {loadStaff,type Permission} from '../../../auth/src/staff-auth';
import {canonical,normalizePeriod,parseConditions,variantMatches,HoldError,type HoldConditions,type PromiseVariant} from '../../../contracts/src/hold';
import {calculate,PricingError,type PriceTable} from '../../../contracts/src/pricing';
import {GROUP_CONFIRMATION_BASIS,GROUP_HELD,GroupError,MAX_MEMBERS,computeGroupTotals,memberConditions,memberKey,partitionMembers,settlementOf,sha256,validateAdminMessage,validateReason,type Adjustment,type GroupMemberInput,type GroupStatus,type MemberBase} from '../../../contracts/src/group-order';
import {planMixedAllocation,writeAllocationClaims} from '../inventory/allocation';
import {writeProvisionalClaims,releaseProvisionalClaims} from '../inventory/provisional-capacity';
import {writeWearClaims} from '../inventory/wear-capacity';
import {assertNotSalesStopped} from '../inventory/sales-stop';
import {heldIntake} from '../inventory/intake-context';

type Conn=Pick<PoolClient,'query'>;
/** The representative proves ownership of one group with the secret handed out when the application started. The shared
 * entrance never authorizes access to an existing group. Staff are re-authorized against the database inside every transaction. */
export type OwnerActor={kind:'OWNER';groupId:string;secret:string};
export type StaffActor={kind:'STAFF';subject:string;revision:number};
export type GroupActor=OwnerActor|StaffActor;
export type GroupRow={id:string;group_number:string;status:GroupStatus;revision:number;contact_name:string;contact_email:string;contact_phone:string|null;locale:'ja'|'en';group_label:string;pickup_store:string;return_store:string;contract_version:string;period:HoldConditions['period'];member_count:number;payment_method:string;confirmation_basis:string|null;confirmed_at:Date|null;confirmed_by:string|null;confirmed_quote_id:string|null;confirmed_total_jpy:string|null;held_at:Date|null;released_at:Date|null;release_reason:string|null;created_at:Date;updated_at:Date};
type MemberRow={id:string;ordinal:number;label:string;profile:Record<string,unknown>;selection:GroupMemberInput['selection'];fit:Record<string,unknown>};
type PartRow={id:string;part_no:number;generation:number;hold_id:string;reservation_id:string;member_count:number;claim_count:number;active:boolean};
type QuoteRow={id:string;version:number;kind:'ESTIMATE'|'CONFIRMED';group_revision:number;price_book_id:string;activation_id:string;lines:unknown;adjustments:Adjustment[];subtotal_jpy:string;bundle_discount_jpy:string;member_discount_jpy:string;group_discount_jpy:string;total_jpy:string;items_digest:string;digest:string;no_charge_confirmed:boolean};
/** The ordinary allocator bounds one plan at 240 requirements (sized for a 20-member hold). A 100-member joint plan has up to 100x5; the bound stays a resource guard, raised only for the group's joint plan (measured in tests/group/core.ts). */
const GROUP_MAX_REQUIREMENTS=520;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const STORES=['MOUNTAIN_BASE','ONSEN_BASE'];
const uuid=(v:unknown):string=>{if(typeof v!=='string'||!UUID.test(v))throw new GroupError('INVALID_ID');return v;};
const n=(v:unknown)=>Number(v);

export class GroupOrderService {
 constructor(private pool:Pool,private clock?:()=>Date){}

 // ------------------------------------------------------------------ plumbing
 private actorKey(a:GroupActor){return a.kind==='OWNER'?'group:'+a.groupId:a.subject;}
 private normalize(e:unknown):never{
  if(e instanceof GroupError||e instanceof HoldError)throw e;
  const code=(e as {code?:string}|null)?.code,msg=(e as Error|null)?.message??'';
  if(['55P03','57014','40P01','40001'].includes(code??''))throw new GroupError('INDETERMINATE',503);
  if(code==='42501')throw new GroupError('FORBIDDEN',403);
  if(code==='23505'&&/reverses_id/.test(msg))throw new GroupError('GROUP_REVERSAL_INVALID',409);
  if(code==='P0062')throw new GroupError('SALES_STOPPED',409);
  if(['23514','23505','23503'].includes(code??''))throw new GroupError(/^GROUP_[A-Z_]+/.exec(msg)?.[0]??'CONFLICT',409);
  throw e;
 }
 private async run<T>(opts:{inventory:boolean;actor:string;timeoutMs?:number},fn:(c:PoolClient,now:Date)=>Promise<T>):Promise<T>{
  let c:PoolClient|undefined;
  try{
   c=await this.pool.connect();await c.query('BEGIN');
   await c.query(`SET LOCAL lock_timeout='3000ms'; SET LOCAL statement_timeout='${opts.timeoutMs??20000}ms'; SET LOCAL idle_in_transaction_session_timeout='60000ms'`);
   // Same allocator exclusion as every ordinary hold command (HoldService.transaction).
   if(opts.inventory)await c.query('SELECT pg_advisory_xact_lock(71820600)');
   await c.query("SELECT set_config('zao.group_op','on',true),set_config('zao.actor',$1,true)",[opts.actor]);
   const now=this.clock?this.clock():(await c.query<{now:Date}>('SELECT inventory_clock() AS now')).rows[0]!.now;
   const v=await fn(c,now);await c.query('COMMIT');return v;
  }catch(e){await c?.query('ROLLBACK').catch(()=>{});return this.normalize(e);}finally{c?.release();}
 }
 private async idem<T>(c:Conn,actor:string,key:string,fingerprint:unknown,fn:()=>Promise<T>):Promise<T&{replayed:boolean}>{
  uuid(key);const fp=sha256(fingerprint);
  const prev=(await c.query<{fingerprint:string;result:T}>('SELECT fingerprint,result FROM group_requests WHERE actor_key=$1 AND request_key=$2',[actor,key])).rows[0];
  if(prev){if(prev.fingerprint!==fp)throw new GroupError('IDEMPOTENCY_MISMATCH',409);return {...prev.result,replayed:true};}
  const result=await fn();await c.query('INSERT INTO group_requests(actor_key,request_key,fingerprint,result) VALUES($1,$2,$3,$4)',[actor,key,fp,JSON.stringify(result)]);
  return {...result,replayed:false};
 }
 private async lock(c:Conn,id:string){
  const g=(await c.query<GroupRow>('SELECT * FROM group_orders WHERE id=$1 FOR UPDATE',[uuid(id)])).rows[0];if(!g)throw new GroupError('NOT_FOUND',404);return g;
 }
 private async authOwner(c:Conn,a:OwnerActor,g:GroupRow){
  if(typeof a.secret!=='string'||a.secret.length<43||a.secret.length>128||a.groupId!==g.id||!(await c.query('SELECT 1 FROM group_orders WHERE id=$1 AND owner_secret_sha256=$2',[g.id,sha256(a.secret)])).rowCount)throw new GroupError('NOT_FOUND',404);
 }
 /** ADMIN only, effective permission and store scope re-read in this transaction (revoked/changed mid-flight => 403). */
 private async authStaff(c:Conn,a:StaffActor,permission:Permission,stores:string[]){
  const p=await loadStaff(c,a.subject);
  if(!p||p.revision!==a.revision||p.role!=='ADMIN'||!(p.permissions as string[]).includes(permission)||stores.some(s=>!(p.storeIds as string[]).includes(s)))throw new GroupError('FORBIDDEN',403);
 }
 private async authorize(c:Conn,a:GroupActor,g:GroupRow,staffPermission:Permission|null){
  if(a.kind==='OWNER'){if(staffPermission)throw new GroupError('FORBIDDEN',403);return this.authOwner(c,a,g);}
  if(!staffPermission)throw new GroupError('FORBIDDEN',403);return this.authStaff(c,a,staffPermission,[g.pickup_store,g.return_store]);
 }
 private async bump(c:Conn,g:GroupRow,set:Record<string,unknown>,action:Record<string,unknown>){
  const cols=Object.keys(set),vals=Object.values(set);
  const r=await c.query<GroupRow>(`UPDATE group_orders SET revision=revision+1,last_action=$1,${cols.map((k,i)=>`${k}=$${i+2}`).join(',')}${cols.length?'':'status=status'} WHERE id=$${cols.length+2} AND revision=$${cols.length+3} RETURNING *`,[JSON.stringify(action),...vals,g.id,g.revision]);
  if(!r.rows[0])throw new GroupError('STALE_REVISION',409);return r.rows[0];
 }
 private expectRevision(g:GroupRow,expected:unknown){if(!Number.isInteger(expected)||g.revision!==expected)throw new GroupError('STALE_REVISION',409,{current:g.revision});}
 private expectStatus(g:GroupRow,...allowed:GroupStatus[]){if(!allowed.includes(g.status))throw new GroupError('INVALID_STATE',409,{status:g.status});}

 // ------------------------------------------------------------------ entrance (admin controls; one permanent URL capability)
 /** Creates or rotates the single permanent entrance token (256-bit, only its hash is stored). The plain token is returned once. */
 async rotateEntrance(staff:StaffActor,reason:string){
  const why=validateReason(reason,200),token=randomBytes(32).toString('base64url');
  return this.run({inventory:false,actor:staff.subject},async c=>{
   await this.authStaff(c,staff,'GROUP_ENTRANCE_MANAGE',STORES);
   const prev=(await c.query<{generation:number}>('SELECT generation FROM group_entrance WHERE id=1 FOR UPDATE')).rows[0];const generation=(prev?.generation??0)+1;
   await c.query(`INSERT INTO group_entrance(id,token_sha256,enabled,generation,updated_by) VALUES(1,$1,true,$2,$3) ON CONFLICT(id) DO UPDATE SET token_sha256=$1,enabled=true,generation=$2,updated_by=$3,updated_at=clock_timestamp()`,[sha256(token),generation,staff.subject]);
   await c.query("INSERT INTO group_entrance_history(generation,action,reason,actor) VALUES($1,'ROTATE',$2,$3)",[generation,why,staff.subject]);
   return {token,generation};
  });
 }
 async setEntranceEnabled(staff:StaffActor,enabled:boolean,reason:string){
  const why=validateReason(reason,200);
  return this.run({inventory:false,actor:staff.subject},async c=>{
   await this.authStaff(c,staff,'GROUP_ENTRANCE_MANAGE',STORES);
   const row=(await c.query<{generation:number}>('SELECT generation FROM group_entrance WHERE id=1 FOR UPDATE')).rows[0];if(!row)throw new GroupError('ENTRANCE_NOT_CONFIGURED',409);
   await c.query('UPDATE group_entrance SET enabled=$1,updated_by=$2,updated_at=clock_timestamp() WHERE id=1',[enabled,staff.subject]);
   await c.query('INSERT INTO group_entrance_history(generation,action,reason,actor) VALUES($1,$2,$3,$4)',[row.generation,enabled?'ENABLE':'DISABLE',why,staff.subject]);
   return {enabled,generation:row.generation};
  });
 }
 /** Read-only: is this token the currently enabled entrance? (page view / CSV template; consumes no inventory, creates nothing). */
 async entranceOpen(token:string){
  if(typeof token!=='string'||token.length<32||token.length>128)return false;
  return Boolean((await this.pool.query('SELECT 1 FROM group_entrance WHERE id=1 AND enabled AND token_sha256=$1',[sha256(token)])).rowCount);
 }
 /** Anyone holding the entrance may start a NEW application; no approval, no per-group invite, no expiry, no use limit.
  * The caller (route layer) generates the 256-bit ownerSecret, hands it to the representative as an HttpOnly cookie and passes
  * it here; only its hash is stored. Replays with the same request key return the same group. Inventory use: none. */
 async startApplication(entranceToken:string,requestKey:string,ownerSecret:string,input:{groupLabel:string;contactName:string;contactEmail:string;contactPhone?:string|null;locale:'ja'|'en';pickupStore:string;returnStore:string;contractVersion:HoldConditions['contractVersion'];period:HoldConditions['period']}){
  if(typeof ownerSecret!=='string'||!/^[A-Za-z0-9_-]{43,128}$/.test(ownerSecret))throw new GroupError('OWNER_SECRET_INVALID');
  if(!input||!STORES.includes(input.pickupStore)||!STORES.includes(input.returnStore)||!['ja','en'].includes(input.locale))throw new GroupError('INVALID_INPUT');
  const email=String(input.contactEmail??'').trim();if(!/^[^\s@\r\n]{1,64}@[^\s@\r\n]{1,190}$/.test(email))throw new GroupError('INVALID_INPUT');
  for(const [k,max] of [['groupLabel',120],['contactName',120]] as const)if(typeof input[k]!=='string'||!input[k].trim()||input[k].length>max)throw new GroupError('INVALID_INPUT');
  if(input.contactPhone!=null&&(typeof input.contactPhone!=='string'||input.contactPhone.length<3||input.contactPhone.length>40))throw new GroupError('INVALID_INPUT');
  try{normalizePeriod(input.period);}catch{throw new GroupError('INVALID_PERIOD');}
  const entranceKey='entrance:'+sha256(entranceToken??'').slice(0,32);
  return this.run({inventory:false,actor:'entrance'},async c=>{
   if(!(await this.entranceOpen(entranceToken)))throw new GroupError('ENTRANCE_UNAVAILABLE',404);
   await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['group-start:'+requestKey]);
   return this.idem(c,entranceKey,requestKey,{input,owner:sha256(ownerSecret)},async()=>{
    const id=randomUUID();
    const g=(await c.query<GroupRow>(`INSERT INTO group_orders(id,owner_secret_sha256,status,contact_name,contact_email,contact_phone,locale,group_label,pickup_store,return_store,contract_version,period,last_action) VALUES($1,$2,'DRAFT',$3,$4,$5,$6,$7,$8,$9,$10,$11,'{"event":"GROUP_STARTED"}') RETURNING *`,[id,sha256(ownerSecret),input.contactName.trim(),email,input.contactPhone??null,input.locale,input.groupLabel.trim(),input.pickupStore,input.returnStore,input.contractVersion??'INTEGRATED_V1_4',JSON.stringify(input.period)])).rows[0]!;
    return {groupId:g.id,groupNumber:g.group_number,revision:g.revision};
   });
  });
 }

 // ------------------------------------------------------------------ members and quote (advisory: no inventory)
 private async members(c:Conn,id:string){return (await c.query<MemberRow>('SELECT id,ordinal,label,profile,selection,fit FROM group_members WHERE group_id=$1 ORDER BY ordinal',[id])).rows;}
 private async parts(c:Conn,id:string,activeOnly=true){return (await c.query<PartRow>(`SELECT id,part_no,generation,hold_id,reservation_id,member_count,claim_count,active FROM group_order_parts WHERE group_id=$1 ${activeOnly?'AND active':''} ORDER BY generation,part_no`,[id])).rows;}
 private baseConditions(g:GroupRow,reservationId:string){return {contractVersion:g.contract_version as HoldConditions['contractVersion'],reservationId,pickupStore:g.pickup_store as HoldConditions['pickupStore'],returnStore:g.return_store as HoldConditions['returnStore'],period:g.period};}
 /** Schema-validates every <=20 part exactly as an ordinary hold would be, plus variant/product consistency. */
 private async validateMembers(c:Conn,g:GroupRow,members:{ordinal:number;selection:GroupMemberInput['selection']}[]){
  const parts=partitionMembers(members);
  for(const part of parts){
   let cond:HoldConditions;try{cond=parseConditions(memberConditions(this.baseConditions(g,randomUUID()),part));}catch(e){throw new GroupError(e instanceof HoldError?e.code:'INVALID_CONDITIONS',422);}
   const ids=[...new Set(cond.members.flatMap(m=>m.items.flatMap(i=>i.variantIds)))];
   const rows=(await c.query<PromiseVariant>(`SELECT v.id,v.family,v.age,v.tier,v.model_id,to_jsonb(v)->'compatible_sports' AS compatible_sports,to_jsonb(m)->>'catalog_season' AS catalog_season FROM ledger_variants v JOIN ledger_models m ON m.id=v.model_id WHERE v.id=ANY($1::uuid[])`,[ids])).rows;
   const by=new Map(rows.map(v=>[v.id,v]));
   for(const m of cond.members)for(const item of m.items)for(const vid of item.variantIds)if(!variantMatches(m,item,by.get(vid)))throw new GroupError('VARIANT_CONDITIONS_MISMATCH',422,{member:m.key});
  }
 }
 /** Replace the member list (stable member ids are kept when supplied). Editing a quoted group re-opens it (quote becomes stale). */
 async saveMembers(actor:OwnerActor,groupId:string,expectedRevision:number,input:GroupMemberInput[]){
  if(!Array.isArray(input)||input.length<1)throw new GroupError('GROUP_EMPTY');if(input.length>MAX_MEMBERS)throw new GroupError('GROUP_TOO_LARGE');
  return this.run({inventory:false,actor:'group:'+actor.groupId},async c=>{
   const g=await this.lock(c,groupId);await this.authorize(c,actor,g,null);this.expectRevision(g,expectedRevision);this.expectStatus(g,'DRAFT','QUOTED');
   const rows=input.map((m,i)=>({id:m.memberId?uuid(m.memberId):randomUUID(),ordinal:i+1,label:String(m.label??'').slice(0,40),profile:m.profile,selection:m.selection,fit:m.fit??{}}));
   if(new Set(rows.map(r=>r.id)).size!==rows.length)throw new GroupError('DUPLICATE_MEMBER');
   await this.validateMembers(c,g,rows);
   await c.query('DELETE FROM group_members WHERE group_id=$1',[g.id]);
   for(const r of rows)await c.query('INSERT INTO group_members(id,group_id,ordinal,label,profile,selection,fit) VALUES($1,$2,$3,$4,$5,$6,$7)',[r.id,g.id,r.ordinal,r.label,JSON.stringify(r.profile),JSON.stringify(r.selection),JSON.stringify(r.fit)]);
   const next=await this.bump(c,g,{member_count:rows.length,status:'DRAFT'},{event:'GROUP_MEMBERS_SAVED',members:rows.length});
   return {revision:next.revision,status:next.status,memberIds:rows.map(r=>r.id)};
  });
 }
 private async pinnedBook(c:Conn,now:Date,pin?:{price_book_id:string;activation_id:string}){
  const a=pin?{id:pin.activation_id,book_id:pin.price_book_id}:(await c.query<{id:string;book_id:string}>('SELECT id,book_id FROM price_activations WHERE effective_at<=$1 ORDER BY effective_at DESC LIMIT 1',[now])).rows[0];
  if(!a)throw new GroupError('NO_PRICE_BOOK',409);
  const b=(await c.query<{id:string;table_jpy:PriceTable;rental_from:string;rental_until:string}>('SELECT id,table_jpy,rental_from::text,rental_until::text FROM price_books WHERE id=$1',[a.book_id])).rows[0];if(!b)throw new GroupError('NO_PRICE_BOOK',409);
  return {book:b,activationId:a.id};
 }
 /** Existing price table / duration / set / wear-discount calculation, per part; never the 5% advance (settlement is on site) and never a coupon. */
 private async computeQuote(c:Conn,g:GroupRow,members:MemberRow[],adjustments:Adjustment[],now:Date,pin?:{price_book_id:string;activation_id:string}){
  const {book,activationId}=await this.pinnedBook(c,now,pin);
  if(g.period.startDate<book.rental_from||g.period.endDate>book.rental_until)throw new GroupError('PRICE_PERIOD_NOT_COVERED',409);
  const bases:MemberBase[]=[],lines:Record<string,unknown>[]=[],itemsForDigest:unknown[]=[];let subtotal=0,bundle=0;
  for(const part of partitionMembers(members)){
   const cond=parseConditions(memberConditions(this.baseConditions(g,randomUUID()),part.map(m=>({ordinal:m.ordinal,selection:m.selection}))));
   let calc:ReturnType<typeof calculate>;
   try{calc=calculate(book.table_jpy,{conditions:cond,holdId:null,couponCode:null,wantAdvance:false},now,null);}catch(e){if(e instanceof PricingError)throw new GroupError('PRICE_NOT_AVAILABLE',422,{code:e.code});throw e;}
   for(const m of part){
    const items=calc.items.filter(i=>i.memberKey===memberKey(m.ordinal));const base=items.reduce((s,i)=>s+i.lineJpy-(i.bundleDiscountJpy??0),0);
    subtotal+=items.reduce((s,i)=>s+i.lineJpy,0);bundle+=items.reduce((s,i)=>s+(i.bundleDiscountJpy??0),0);
    bases.push({memberId:m.id,ordinal:m.ordinal,baseJpy:base});
    lines.push({memberId:m.id,ordinal:m.ordinal,items:items.map(i=>({productKey:i.productKey,duration:i.duration,unitJpy:i.unitJpy,lineJpy:i.lineJpy,bundleDiscountJpy:i.bundleDiscountJpy??0}))});
    itemsForDigest.push({memberId:m.id,selection:m.selection,items:items.map(i=>[i.productKey,i.lineJpy,i.bundleDiscountJpy??0])});
   }
  }
  const totals=computeGroupTotals(bases,adjustments);
  for(const l of lines){const t=totals.members.find(x=>x.memberId===l.memberId)!;Object.assign(l,{baseJpy:t.baseJpy,memberDiscountJpy:t.memberDiscountJpy,groupDiscountJpy:t.groupDiscountJpy,finalJpy:t.finalJpy});}
  const itemsDigest=sha256({period:g.period,stores:[g.pickup_store,g.return_store],book:book.id,itemsForDigest});
  const body={lines,adjustments,subtotal,bundle,member:totals.memberDiscountJpy,group:totals.groupDiscountJpy,total:totals.totalJpy,book:book.id,activation:activationId};
  return {...body,totals,priceBookId:book.id,activationId,itemsDigest,digest:sha256(body)};
 }
 private async insertQuote(c:Conn,g:GroupRow,kind:'ESTIMATE'|'CONFIRMED',q:Awaited<ReturnType<GroupOrderService['computeQuote']>>,by:string,noCharge:boolean,groupRevision:number){
  const version=(n((await c.query('SELECT coalesce(max(version),0) m FROM group_quotes WHERE group_id=$1',[g.id])).rows[0].m))+1,id=randomUUID();
  await c.query('INSERT INTO group_quotes(id,group_id,version,kind,group_revision,price_book_id,activation_id,lines,adjustments,subtotal_jpy,bundle_discount_jpy,member_discount_jpy,group_discount_jpy,total_jpy,items_digest,digest,no_charge_confirmed,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)',
   [id,g.id,version,kind,groupRevision,q.priceBookId,q.activationId,JSON.stringify(q.lines),JSON.stringify(q.adjustments),q.subtotal,q.bundle,q.member,q.group,q.total,q.itemsDigest,q.digest,noCharge,by]);
  return {id,version};
 }
 /** Advisory estimate (DRAFT -> QUOTED). No inventory is held. */
 async quote(actor:OwnerActor,groupId:string,expectedRevision:number){
  return this.run({inventory:false,actor:'group:'+actor.groupId},async(c,now)=>{
   const g=await this.lock(c,groupId);await this.authorize(c,actor,g,null);this.expectRevision(g,expectedRevision);this.expectStatus(g,'DRAFT');
   const members=await this.members(c,g.id);if(!members.length||members.length!==g.member_count)throw new GroupError('GROUP_EMPTY');
   const q=await this.computeQuote(c,g,members,[],now);
   const next=await this.bump(c,g,{status:'QUOTED'},{event:'GROUP_QUOTED'});
   const ref=await this.insertQuote(c,g,'ESTIMATE',q,'group:'+g.id,q.total===0,next.revision);
   return {revision:next.revision,quoteId:ref.id,version:ref.version,totalJpy:q.total,digest:q.digest,itemsDigest:q.itemsDigest};
  });
 }
 /** The representative confirms the explanation/terms for exactly this quote and fixes the ceiling the administrator may confirm within. */
 async consent(actor:OwnerActor,groupId:string,input:{quoteId:string;digest:string;termsVersion:string;termsSha256:string;explanationConfirmed:boolean}){
  return this.run({inventory:false,actor:'group:'+actor.groupId},async c=>{
   const g=await this.lock(c,groupId);await this.authorize(c,actor,g,null);this.expectStatus(g,'QUOTED','REVIEW_HELD','CHANGES_REQUESTED');
   if(input.explanationConfirmed!==true||!/^[a-f0-9]{64}$/.test(input.termsSha256??'')||typeof input.termsVersion!=='string')throw new GroupError('CONSENT_INVALID');
   const q=(await c.query<QuoteRow>("SELECT * FROM group_quotes WHERE id=$1 AND group_id=$2 AND kind='ESTIMATE' AND version=(SELECT max(version) FROM group_quotes WHERE group_id=$2 AND kind='ESTIMATE')",[uuid(input.quoteId),g.id])).rows[0];
   if(!q||q.digest!==input.digest)throw new GroupError('QUOTE_STALE',409);
   await c.query('INSERT INTO group_consents(id,group_id,quote_id,quote_digest,items_digest,max_total_jpy,terms_version,terms_sha256,explanation_confirmed) VALUES($1,$2,$3,$4,$5,$6,$7,$8,true) ON CONFLICT(quote_id) DO NOTHING',[randomUUID(),g.id,q.id,q.digest,q.items_digest,q.total_jpy,input.termsVersion,input.termsSha256]);
   return {quoteId:q.id,maxTotalJpy:n(q.total_jpy)};
  });
 }

 // ------------------------------------------------------------------ the atomic joint reservation
 /** One joint plan over ALL members (as one allocation problem), then every part's hold/claims are written in the caller's
  * transaction under the allocator lock. Any failure throws and the caller's ROLLBACK removes everything (parent, parts, claims). */
 private async reserveAll(c:Conn,g:GroupRow,members:MemberRow[],now:Date,generation:number,revision:number){
  const owner=await c.query<{r:string}>('SELECT group_register_actor($1) AS r',[g.id]).then(r=>r.rows[0]!.r);
  const chunks=partitionMembers(members.map(m=>({ordinal:m.ordinal,selection:m.selection})));
  const partConds=chunks.map(ch=>parseConditions(memberConditions(this.baseConditions(g,randomUUID()),ch)));
  for(const pc of partConds){await heldIntake(c,pc,now,null);await assertNotSalesStopped(c,pc);}
  const all:HoldConditions={...partConds[0]!,reservationId:randomUUID(),members:partConds.flatMap(p=>p.members)};
  const plan=await planMixedAllocation(c,all,now,null,undefined,false,GROUP_MAX_REQUIREMENTS);
  if(plan.result!=='FEASIBLE')throw new GroupError('INSUFFICIENT_STOCK',409,{result:plan.result,members:members.length});
  const before=(await c.query('SELECT hold_id,requirement_key,asset_id,pole_id,pole_slot,day FROM inventory_claims WHERE hold_id=ANY($1::uuid[]) AND active ORDER BY id',[plan.replanned])).rows;
  if(plan.replanned.length)await c.query('UPDATE inventory_claims SET active=false WHERE hold_id=ANY($1::uuid[]) AND active',[plan.replanned]);
  for(const otherId of plan.replanned){const other=(await c.query<{conditions:HoldConditions}>('SELECT conditions FROM inventory_holds WHERE id=$1',[otherId])).rows[0]!;await writeAllocationClaims(c,otherId,other.conditions,plan.witness.filter(w=>w.holdId===otherId));}
  const created:{partNo:number;holdId:string;claims:number;members:number}[]=[];
  for(const [i,pc] of partConds.entries()){
   const period=normalizePeriod(pc.period),holdId=randomUUID(),keys=new Set(pc.members.map(m=>m.key));
   const mine=(k:string)=>keys.has(k.split(':')[0]!);
   await c.query('INSERT INTO inventory_reservations VALUES($1,$2) ON CONFLICT DO NOTHING',[pc.reservationId,owner]);
   // GROUP_RESERVED + expires_at NULL: the explicit no-expiry protection kind (see migration 0064).
   await c.query(`INSERT INTO inventory_holds(id,reservation_id,owner_id,pickup_store,return_store,conditions,starts_at,due_at,occupancy_start,occupancy_end,expires_at,state,allocation_stage,buffer_override) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NULL,'ACTIVE','GROUP_RESERVED',false)`,[holdId,pc.reservationId,owner,pc.pickupStore,pc.returnStore,JSON.stringify(pc),period.startsAt,period.dueAt,pc.period.startDate,pc.period.endDate]);
   await writeAllocationClaims(c,holdId,pc,plan.witness.filter(w=>w.holdId==='candidate'&&mine(w.key)));
   const prov=plan.provisional.filter(p=>mine(p.key));if(prov.length)await writeProvisionalClaims(c,holdId,prov,period.dates,now,false);
   if(pc.members.some(m=>m.items.some(it=>it.family.startsWith('WEAR_'))))await writeWearClaims(c,holdId,pc,now,new Set([...plan.wearExcludeKeys].filter(mine)),false);
   const claims=n((await c.query("SELECT (SELECT count(*) FROM inventory_claims WHERE hold_id=$1 AND active)+(SELECT count(*) FROM provisional_capacity_claims WHERE hold_id=$1 AND state='ACTIVE')+(SELECT count(*) FROM wear_claims WHERE hold_id=$1 AND active) AS n",[holdId])).rows[0].n);
   await c.query('INSERT INTO group_order_parts(id,group_id,part_no,generation,hold_id,reservation_id,member_count,claim_count,created_revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[randomUUID(),g.id,i+1,generation,holdId,pc.reservationId,pc.members.length,claims,revision]);
   await c.query('UPDATE group_members SET part_no=$2 WHERE group_id=$1 AND ordinal=ANY($3::int[])',[g.id,i+1,chunks[i]!.map(m=>m.ordinal)]);
   created.push({partNo:i+1,holdId,claims,members:pc.members.length});
  }
  const after=(await c.query('SELECT hold_id,requirement_key,asset_id,pole_id,pole_slot,day FROM inventory_claims WHERE hold_id=ANY($1::uuid[]) AND active ORDER BY id',[[...plan.replanned,...created.map(p=>p.holdId)]])).rows;
  await c.query('SELECT inventory_record_replan($1::jsonb,$2::jsonb)',[JSON.stringify(before),JSON.stringify(after)]);
  return created;
 }
 /** Customer "send confirmation request": reserves EVERY member in one transaction (REVIEW_HELD), or nothing at all. */
 async submit(actor:OwnerActor,groupId:string,input:{requestKey:string;expectedRevision:number;quoteId:string}){
  return this.run({inventory:true,actor:'group:'+actor.groupId,timeoutMs:60000},async(c,now)=>{
   const g=await this.lock(c,groupId);await this.authorize(c,actor,g,null);
   return this.idem(c,'group:'+g.id,input.requestKey,{op:'submit',rev:input.expectedRevision,quote:input.quoteId},async()=>{
    this.expectRevision(g,input.expectedRevision);this.expectStatus(g,'QUOTED');
    const q=(await c.query<QuoteRow>("SELECT * FROM group_quotes WHERE id=$1 AND group_id=$2 AND kind='ESTIMATE'",[uuid(input.quoteId),g.id])).rows[0];
    if(!q||q.group_revision!==g.revision)throw new GroupError('QUOTE_STALE',409);
    if(!(await c.query('SELECT 1 FROM group_consents WHERE quote_id=$1 AND quote_digest=$2',[q.id,q.digest])).rowCount)throw new GroupError('CONSENT_REQUIRED',409);
    const members=await this.members(c,g.id);if(members.length!==g.member_count)throw new GroupError('GROUP_EMPTY');
    const fresh=await this.computeQuote(c,g,members,[],now,{price_book_id:q.price_book_id,activation_id:q.activation_id});
    if(fresh.digest!==q.digest)throw new GroupError('REQUOTE_REQUIRED',409);
    const created=await this.reserveAll(c,g,members,now,1,g.revision+1);
    const next=await this.bump(c,g,{status:'REVIEW_HELD',held_at:now},{event:'GROUP_REVIEW_HELD',parts:created.length,members:members.length});
    return {revision:next.revision,status:'REVIEW_HELD' as const,parts:created.length,members:members.length,claims:created.reduce((s,p)=>s+p.claims,0)};
   });
  });
 }

 // ------------------------------------------------------------------ release / cancel (explicit, atomic, no partial)
 private async releaseHolds(c:Conn,parts:PartRow[]){
  const ids=parts.map(p=>p.hold_id);if(!ids.length)return;
  await c.query("UPDATE inventory_holds SET state='RELEASED',version=version+1 WHERE id=ANY($1::uuid[]) AND state='ACTIVE'",[ids]);
  await c.query('UPDATE inventory_claims SET active=false WHERE hold_id=ANY($1::uuid[]) AND active',[ids]);
  await c.query('UPDATE wear_claims SET active=false WHERE hold_id=ANY($1::uuid[]) AND active',[ids]);
  for(const id of ids)await releaseProvisionalClaims(c,id);
 }
 /** ADMIN "release the hold": parent, all parts and all claims in one transaction; the inventory is immediately available to other bookings. */
 async release(staff:StaffActor,groupId:string,input:{requestKey:string;expectedRevision:number;reason:string;message?:string|null}){
  const reason=validateReason(input.reason),message=validateAdminMessage(input.message);
  return this.run({inventory:true,actor:staff.subject},async(c,now)=>{
   const g=await this.lock(c,groupId);await this.authStaff(c,staff,'GROUP_RELEASE',[g.pickup_store,g.return_store]);
   return this.idem(c,staff.subject,input.requestKey,{op:'release',group:g.id,rev:input.expectedRevision,reason},async()=>{
    this.expectRevision(g,input.expectedRevision);this.expectStatus(g,'REVIEW_HELD','CHANGES_REQUESTED');
    const parts=await this.parts(c,g.id);await this.releaseHolds(c,parts);
    const next=await this.bump(c,g,{status:'RELEASED',released_at:now,released_by:staff.subject,release_reason:reason},{event:'GROUP_RELEASED',reason,...(message?{message}:{})});
    return {revision:next.revision,status:'RELEASED' as const,releasedParts:parts.length};
   });
  });
 }
 /** Formal cancellation of a CONFIRMED group. Releases the protected inventory; never invents a refund (net on-site receipts are reported for manual handling). */
 async cancelConfirmed(staff:StaffActor,groupId:string,input:{requestKey:string;expectedRevision:number;reason:string;message?:string|null}){
  const reason=validateReason(input.reason),message=validateAdminMessage(input.message);
  return this.run({inventory:true,actor:staff.subject},async(c,now)=>{
   const g=await this.lock(c,groupId);await this.authStaff(c,staff,'GROUP_CANCEL',[g.pickup_store,g.return_store]);
   return this.idem(c,staff.subject,input.requestKey,{op:'cancel',group:g.id,rev:input.expectedRevision,reason},async()=>{
    this.expectRevision(g,input.expectedRevision);this.expectStatus(g,'CONFIRMED');
    // Same rule as an ordinary booking: nothing that is out on loan can be cancelled away; it must be returned first (the database repeats this).
    if((await c.query("SELECT 1 FROM rental_loan_items l JOIN group_order_parts p ON p.id=l.group_part_id WHERE p.group_id=$1 AND l.state='OUT' LIMIT 1",[g.id])).rowCount)throw new GroupError('GROUP_LOANS_OUT',409);
    const settlement=await this.settlement(c,g);const parts=await this.parts(c,g.id);await this.releaseHolds(c,parts);
    const next=await this.bump(c,g,{status:'CANCELLED',cancelled_at:now,cancelled_by:staff.subject},{event:'GROUP_CANCELLED',reason,receivedJpyNeedsManualRefund:settlement.receivedJpy,...(message?{message}:{})});
    return {revision:next.revision,status:'CANCELLED' as const,receivedJpyNeedsManualRefund:settlement.receivedJpy,refundJpy:0};
   });
  });
 }

 // ------------------------------------------------------------------ administrator discounts, requests, amend
 private async currentAdjustments(c:Conn,id:string):Promise<Adjustment[]>{
  return (await c.query<{target:'MEMBER'|'GROUP';member_id:string|null;method:'FIXED_JPY'|'PERCENT_BPS';value:number;reason:string}>('SELECT target,member_id,method,value,reason FROM group_adjustments WHERE group_id=$1 AND set_no=(SELECT max(set_no) FROM group_adjustments WHERE group_id=$1) ORDER BY occurred_at,id',[id])).rows.map(r=>({target:r.target,...(r.member_id?{memberId:r.member_id}:{}),method:r.method,value:r.value,reason:r.reason}));
 }
 private async groupBases(c:Conn,g:GroupRow,now:Date){
  const members=await this.members(c,g.id);const est=(await c.query<QuoteRow>("SELECT * FROM group_quotes WHERE group_id=$1 AND kind='ESTIMATE' ORDER BY version DESC LIMIT 1",[g.id])).rows[0];
  if(!est)throw new GroupError('QUOTE_REQUIRED',409);return {members,est,calc:(adj:Adjustment[])=>this.computeQuote(c,g,members,adj,now,{price_book_id:est.price_book_id,activation_id:est.activation_id})};
 }
 /** Replaces the whole discount set (participant-level first, then one group-wide), each with reason, actor and before/after. */
 async setAdjustments(staff:StaffActor,groupId:string,expectedRevision:number,adjustments:Adjustment[]){
  if(!Array.isArray(adjustments)||adjustments.length>MAX_MEMBERS+1)throw new GroupError('ADJUSTMENT_INVALID');
  return this.run({inventory:false,actor:staff.subject},async(c,now)=>{
   const g=await this.lock(c,groupId);await this.authStaff(c,staff,'GROUP_DISCOUNT',[g.pickup_store,g.return_store]);
   this.expectRevision(g,expectedRevision);this.expectStatus(g,'REVIEW_HELD','CHANGES_REQUESTED');
   const {calc}=await this.groupBases(c,g,now);const q=await calc(adjustments);
   const set=n((await c.query('SELECT coalesce(max(set_no),0) m FROM group_adjustments WHERE group_id=$1',[g.id])).rows[0].m)+1;
   for(const a of adjustments){const au=q.totals.audit.find(x=>x.target===a.target&&(x.memberId??null)===(a.memberId??null))!;
    await c.query('INSERT INTO group_adjustments(id,group_id,set_no,target,member_id,method,value,reason,actor,before_jpy,after_jpy) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[randomUUID(),g.id,set,a.target,a.memberId??null,a.method,a.value,a.reason.trim(),staff.subject,au.beforeJpy,au.afterJpy]);}
   const next=await this.bump(c,g,{},{event:'GROUP_DISCOUNTED',set,totalJpy:q.total});
   return {revision:next.revision,set,totalJpy:q.total,members:q.totals.members.map(m=>({memberId:m.memberId,finalJpy:m.finalJpy}))};
  });
 }
 /** Pure preview of what the confirmation (and its customer email) would state. Writes nothing. */
 async previewConfirmation(staff:StaffActor,groupId:string){
  return this.run({inventory:false,actor:staff.subject},async(c,now)=>{
   const g=(await c.query<GroupRow>('SELECT * FROM group_orders WHERE id=$1',[uuid(groupId)])).rows[0];if(!g)throw new GroupError('NOT_FOUND',404);
   await this.authStaff(c,staff,'GROUP_VIEW',[g.pickup_store,g.return_store]);
   const {calc}=await this.groupBases(c,g,now);const q=await calc(await this.currentAdjustments(c,g.id));
   return {baseJpy:q.totals.baseJpy-0,subtotalJpy:q.subtotal,bundleDiscountJpy:q.bundle,memberDiscountJpy:q.member,groupDiscountJpy:q.group,totalJpy:q.total,paymentMethod:'PAY_ON_SITE' as const,settlement:'UNPAID' as const};
  });
 }
 /** Administrator asks the representative for changes. The existing hold is kept untouched. */
 async requestChanges(staff:StaffActor,groupId:string,input:{requestKey:string;expectedRevision:number;message:string}){
  const message=validateAdminMessage(input.message);if(!message)throw new GroupError('MESSAGE_INVALID');
  return this.run({inventory:false,actor:staff.subject},async c=>{
   const g=await this.lock(c,groupId);await this.authStaff(c,staff,'GROUP_APPROVE',[g.pickup_store,g.return_store]);
   return this.idem(c,staff.subject,input.requestKey,{op:'requestChanges',group:g.id,rev:input.expectedRevision,message},async()=>{
    this.expectRevision(g,input.expectedRevision);this.expectStatus(g,'REVIEW_HELD');
    await c.query("INSERT INTO group_change_requests(id,group_id,kind,body,created_revision) VALUES($1,$2,'ADMIN_REQUEST',$3,$4)",[randomUUID(),g.id,message,g.revision+1]);
    const next=await this.bump(c,g,{status:'CHANGES_REQUESTED'},{event:'GROUP_CHANGES_REQUESTED',message});
    return {revision:next.revision,status:'CHANGES_REQUESTED' as const};
   });
  });
 }
 /** Customer change / decline wish: only recorded for the administrator. It never releases or alters the reservation. */
 async requestFromCustomer(actor:OwnerActor,groupId:string,input:{requestKey:string;kind:'CHANGE'|'DECLINE';body:string;payload?:Record<string,unknown>}){
  if(!['CHANGE','DECLINE'].includes(input.kind)||typeof input.body!=='string'||input.body.length>2000)throw new GroupError('INVALID_INPUT');
  return this.run({inventory:false,actor:'group:'+actor.groupId},async c=>{
   const g=await this.lock(c,groupId);await this.authorize(c,actor,g,null);
   return this.idem(c,'group:'+g.id,input.requestKey,{op:'customerRequest',input},async()=>{
    this.expectStatus(g,'REVIEW_HELD','CHANGES_REQUESTED','CONFIRMED');
    const id=randomUUID();await c.query('INSERT INTO group_change_requests(id,group_id,kind,body,payload,created_revision) VALUES($1,$2,$3,$4,$5,$6)',[id,g.id,input.kind,input.body,JSON.stringify(input.payload??{}),g.revision]);
    await c.query('INSERT INTO group_events(group_id,revision,event_type,actor,payload) VALUES($1,$2,$3,$4,$5)',[g.id,g.revision,input.kind==='DECLINE'?'GROUP_DECLINE_REQUESTED':'GROUP_CHANGE_REQUESTED_BY_CUSTOMER',actor.kind==='OWNER'?'group:'+g.id:'?',JSON.stringify({requestId:id})]);
    return {requestId:id,revision:g.revision,statusUnchanged:g.status};
   });
  });
 }
 /** Administrator-approved amendment: the NEW member set is planned jointly while the old holds are released inside the same
  * transaction. If the new set cannot be reserved the whole transaction rolls back and the old reservation is untouched. */
 async applyChange(staff:StaffActor,groupId:string,input:{requestKey:string;expectedRevision:number;changeRequestId?:string|null;members:GroupMemberInput[]}){
  if(!Array.isArray(input.members)||input.members.length<1||input.members.length>MAX_MEMBERS)throw new GroupError('GROUP_TOO_LARGE');
  return this.run({inventory:true,actor:staff.subject,timeoutMs:60000},async(c,now)=>{
   const g=await this.lock(c,groupId);await this.authStaff(c,staff,'GROUP_APPROVE',[g.pickup_store,g.return_store]);
   return this.idem(c,staff.subject,input.requestKey,{op:'applyChange',group:g.id,rev:input.expectedRevision,m:input.members},async()=>{
    this.expectRevision(g,input.expectedRevision);this.expectStatus(g,'REVIEW_HELD','CHANGES_REQUESTED');
    await c.query("SELECT set_config('zao.group_amend','on',true)");
    const rows=input.members.map((m,i)=>({id:m.memberId?uuid(m.memberId):randomUUID(),ordinal:i+1,label:String(m.label??'').slice(0,40),profile:m.profile,selection:m.selection,fit:m.fit??{}}));
    await this.validateMembers(c,g,rows);
    const old=await this.parts(c,g.id);const generation=Math.max(...old.map(p=>p.generation),0)+1;
    await this.releaseHolds(c,old);await c.query('UPDATE group_order_parts SET active=false WHERE group_id=$1 AND active',[g.id]);
    await c.query('DELETE FROM group_members WHERE group_id=$1',[g.id]);
    for(const r of rows)await c.query('INSERT INTO group_members(id,group_id,ordinal,label,profile,selection,fit) VALUES($1,$2,$3,$4,$5,$6,$7)',[r.id,g.id,r.ordinal,r.label,JSON.stringify(r.profile),JSON.stringify(r.selection),JSON.stringify(r.fit)]);
    const memberRows=await this.members(c,g.id);
    const created=await this.reserveAll(c,{...g,member_count:rows.length},memberRows,now,generation,g.revision+1);
    const next=await this.bump(c,g,{status:'REVIEW_HELD',member_count:rows.length},{event:'GROUP_AMENDED',parts:created.length,members:rows.length});
    // The customer must accept the re-computed estimate before the administrator can confirm it.
    const q=await this.computeQuote(c,{...next},memberRows,[],now);await this.insertQuote(c,next,'ESTIMATE',q,staff.subject,q.total===0,next.revision);
    if(input.changeRequestId)await c.query("UPDATE group_change_requests SET status='APPLIED',resolved_at=$3,resolved_by=$4 WHERE id=$1 AND group_id=$2 AND status='OPEN'",[uuid(input.changeRequestId),g.id,now,staff.subject]);
    return {revision:next.revision,status:'REVIEW_HELD' as const,parts:created.length,members:rows.length,totalJpy:q.total,consentRequired:true as const};
   });
  });
 }

 // ------------------------------------------------------------------ confirmation (administrator)
 /** "Confirm and send mail": CONFIRMED + unpaid + pay on site. Confirmation basis is GROUP_ADMIN_APPROVED; there is no provider
  * attempt, no payment_state SUCCESS and no received amount. Everything is re-verified in this one transaction. */
 async confirm(staff:StaffActor,groupId:string,input:{requestKey:string;expectedRevision:number;message?:string|null;noChargeConfirmed?:boolean;fitAcknowledgedMemberIds?:string[]}){
  const message=validateAdminMessage(input.message);
  return this.run({inventory:true,actor:staff.subject,timeoutMs:60000},async(c,now)=>{
   const g=await this.lock(c,groupId);await this.authStaff(c,staff,'GROUP_APPROVE',[g.pickup_store,g.return_store]);
   return this.idem(c,staff.subject,input.requestKey,{op:'confirm',group:g.id,rev:input.expectedRevision,message,nc:!!input.noChargeConfirmed,fit:input.fitAcknowledgedMemberIds??[]},async()=>{
    this.expectRevision(g,input.expectedRevision);this.expectStatus(g,'REVIEW_HELD');
    const parts=await this.parts(c,g.id);
    if(!parts.length||parts.reduce((s,p)=>s+p.member_count,0)!==g.member_count)throw new GroupError('GROUP_PARTS_INCOMPLETE',409);
    for(const p of parts){
     const h=(await c.query<{state:string;allocation_stage:string;payment_state:string;conditions:HoldConditions}>('SELECT state,allocation_stage,payment_state,conditions FROM inventory_holds WHERE id=$1',[p.hold_id])).rows[0];
     if(!h||h.state!=='ACTIVE'||h.allocation_stage!=='GROUP_RESERVED'||h.payment_state!=='NONE')throw new GroupError('HOLD_NOT_PROTECTED',409);
     const claims=n((await c.query("SELECT (SELECT count(*) FROM inventory_claims WHERE hold_id=$1 AND active)+(SELECT count(*) FROM provisional_capacity_claims WHERE hold_id=$1 AND state='ACTIVE')+(SELECT count(*) FROM wear_claims WHERE hold_id=$1 AND active) AS n",[p.hold_id])).rows[0].n);
     if(claims!==p.claim_count)throw new GroupError('CLAIMS_CHANGED',409);
     if((await c.query(`SELECT 1 FROM inventory_claims cl JOIN transfer_pieces tp ON tp.id=cl.transfer_piece_id JOIN transfer_batches b ON b.id=tp.batch_id WHERE cl.active AND cl.hold_id=$1 AND (b.issue IS NOT NULL OR (b.planned_ready_at<$2 AND tp.state NOT IN ('READY','CLOSED'))) LIMIT 1`,[p.hold_id,now])).rowCount)throw new GroupError('TRANSFER_RECONCILIATION_REQUIRED',409);
     await assertNotSalesStopped(c,h.conditions);
    }
    const members=await this.members(c,g.id);
    const manual=members.filter(m=>m.fit?.status==='MANUAL_FIT_REQUIRED').map(m=>m.id),acked=new Set(input.fitAcknowledgedMemberIds??[]);
    if(manual.some(id=>!acked.has(id)))throw new GroupError('FIT_CONFIRMATION_REQUIRED',409,{memberIds:manual.filter(id=>!acked.has(id))});
    const {est,calc}=await this.groupBases(c,g,now);
    const consent=(await c.query<{max_total_jpy:string;items_digest:string}>('SELECT max_total_jpy,items_digest FROM group_consents WHERE quote_id=$1',[est.id])).rows[0];
    if(!consent)throw new GroupError('CONSENT_REQUIRED',409);
    const q=await calc(await this.currentAdjustments(c,g.id));
    if(q.itemsDigest!==consent.items_digest||q.total>n(consent.max_total_jpy))throw new GroupError('RECONSENT_REQUIRED',409,{consentedMaxJpy:n(consent.max_total_jpy),totalJpy:q.total});
    if(q.total===0&&!input.noChargeConfirmed)throw new GroupError('NO_CHARGE_CONFIRMATION_REQUIRED',409);
    const ref=await this.insertQuote(c,g,'CONFIRMED',q,staff.subject,q.total===0,g.revision+1);
    const next=await this.bump(c,g,{status:'CONFIRMED',confirmation_basis:GROUP_CONFIRMATION_BASIS,confirmed_at:now,confirmed_by:staff.subject,confirmed_quote_id:ref.id,confirmed_total_jpy:q.total},{event:'GROUP_CONFIRMED',totalJpy:q.total,subtotalJpy:q.subtotal,discountJpy:q.member+q.group+q.bundle,paymentMethod:'PAY_ON_SITE',...(message?{message}:{})});
    return {revision:next.revision,status:'CONFIRMED' as const,totalJpy:q.total,quoteId:ref.id,paymentMethod:'PAY_ON_SITE' as const,settlement:q.total===0?'NO_CHARGE' as const:'UNPAID' as const};
   });
  });
 }

 // ------------------------------------------------------------------ on-site receipts (actual receipts only)
 async recordReceipt(staff:StaffActor,groupId:string,input:{requestKey:string;amountJpy:number;method:'CASH'|'CARD_AT_COUNTER'|'OTHER_ON_SITE';receivedAt:string;note?:string}){
  if(!Number.isSafeInteger(input.amountJpy)||input.amountJpy<1||!['CASH','CARD_AT_COUNTER','OTHER_ON_SITE'].includes(input.method)||!Number.isFinite(Date.parse(input.receivedAt)))throw new GroupError('INVALID_INPUT');
  return this.run({inventory:false,actor:staff.subject},async c=>{
   const g=await this.lock(c,groupId);await this.authStaff(c,staff,'GROUP_PAYMENT_RECORD',[g.pickup_store,g.return_store]);
   return this.idem(c,staff.subject,input.requestKey,{op:'receipt',group:g.id,input},async()=>{
    const id=randomUUID();await c.query("INSERT INTO group_payments(id,group_id,kind,amount_jpy,method,received_at,note,recorded_by) VALUES($1,$2,'RECEIPT',$3,$4,$5,$6,$7)",[id,g.id,input.amountJpy,input.method,input.receivedAt,String(input.note??'').slice(0,300),staff.subject]);
    return {paymentId:id,settlement:await this.settlement(c,g)};
   });
  });
 }
 /** Correction = full reversal of a recorded receipt (then record the right one). Append-only, reason required. */
 async reverseReceipt(staff:StaffActor,groupId:string,input:{requestKey:string;paymentId:string;reason:string}){
  const reason=validateReason(input.reason);
  return this.run({inventory:false,actor:staff.subject},async(c,now)=>{
   const g=await this.lock(c,groupId);await this.authStaff(c,staff,'GROUP_PAYMENT_RECORD',[g.pickup_store,g.return_store]);
   return this.idem(c,staff.subject,input.requestKey,{op:'reverse',group:g.id,input},async()=>{
    const r=(await c.query<{amount_jpy:string;method:string}>("SELECT amount_jpy,method FROM group_payments WHERE id=$1 AND group_id=$2 AND kind='RECEIPT'",[uuid(input.paymentId),g.id])).rows[0];if(!r)throw new GroupError('NOT_FOUND',404);
    const id=randomUUID();await c.query("INSERT INTO group_payments(id,group_id,kind,amount_jpy,method,received_at,reverses_id,reason,recorded_by) VALUES($1,$2,'REVERSAL',$3,$4,$5,$6,$7,$8)",[id,g.id,r.amount_jpy,r.method,now,input.paymentId,reason,staff.subject]);
    return {paymentId:id,settlement:await this.settlement(c,g)};
   });
  });
 }
 private async settlement(c:Conn,g:GroupRow){
  const rows=(await c.query<{kind:'RECEIPT'|'REVERSAL';amount_jpy:string}>('SELECT kind,amount_jpy FROM group_payments WHERE group_id=$1',[g.id])).rows;
  return settlementOf(g.confirmed_total_jpy===null?null:n(g.confirmed_total_jpy),rows.map(r=>({kind:r.kind,amountJpy:n(r.amount_jpy)})));
 }

 // ------------------------------------------------------------------ reads
 private async detail(c:Conn,g:GroupRow,now:Date,staff:boolean){
  const members=await this.members(c,g.id),parts=await this.parts(c,g.id,false);
  const quotes=(await c.query('SELECT id,version,kind,group_revision,total_jpy,subtotal_jpy,digest,created_at FROM group_quotes WHERE group_id=$1 ORDER BY version',[g.id])).rows;
  const events=(await c.query('SELECT id,revision,event_type,actor,payload,occurred_at FROM group_events WHERE group_id=$1 ORDER BY id',[g.id])).rows;
  const jst=(d:Date)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo'}).format(d);
  const daysPastStart=Math.max(0,Math.round((Date.parse(jst(now))-Date.parse(g.period.startDate))/86400000));
  return {group:{id:g.id,groupNumber:g.group_number,status:g.status,revision:g.revision,label:g.group_label,locale:g.locale,pickupStore:g.pickup_store,returnStore:g.return_store,period:g.period,memberCount:g.member_count,paymentMethod:g.payment_method,confirmationBasis:g.confirmation_basis,confirmedTotalJpy:g.confirmed_total_jpy===null?null:n(g.confirmed_total_jpy),heldAt:g.held_at,releasedAt:g.released_at,
   // A past usage date is only an attention flag; nothing is ever released automatically.
   attention:GROUP_HELD.includes(g.status)&&daysPastStart>0?{kind:'START_DATE_PASSED',daysPastStart}:null,
   ...(staff?{contactName:g.contact_name,contactEmail:g.contact_email,contactPhone:g.contact_phone}:{})},
   members:members.map(m=>({id:m.id,ordinal:m.ordinal,label:m.label,selection:m.selection,fit:m.fit,...(staff?{profile:m.profile}:{})})),
   parts:parts.map(p=>({partNo:p.part_no,generation:p.generation,active:p.active,members:p.member_count,holdId:staff?p.hold_id:undefined})),quotes,events:staff?events:events.filter(e=>/^GROUP_(REVIEW_HELD|CONFIRMED|CHANGES_REQUESTED|RELEASED|CANCELLED)$/.test(e.event_type)),settlement:await this.settlement(c,g),
   adjustments:staff?await this.currentAdjustments(c,g.id):undefined};
 }
 /** Representative: own group only (404 for anything else). Staff: ADMIN + GROUP_VIEW + store scope. */
 async get(actor:GroupActor,groupId:string){
  const c=await this.pool.connect();
  try{await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
   const g=(await c.query<GroupRow>('SELECT * FROM group_orders WHERE id=$1',[uuid(groupId)])).rows[0];if(!g)throw new GroupError('NOT_FOUND',404);
   await this.authorize(c,actor,g,actor.kind==='STAFF'?'GROUP_VIEW':null);
   const now=this.clock?this.clock():(await c.query<{now:Date}>('SELECT inventory_clock() AS now')).rows[0]!.now;
   const v=await this.detail(c,g,now,actor.kind==='STAFF');await c.query('COMMIT');return v;
  }catch(e){await c.query('ROLLBACK').catch(()=>{});return this.normalize(e);}finally{c.release();}
 }
 /** Admin list: pending count, received time, days held, usage-date approach/passage, stock occupation. Sorting/filtering only. */
 async list(staff:StaffActor,filter:{status?:GroupStatus[];store?:string}={}){
  const c=await this.pool.connect();
  try{await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
   await this.authStaff(c,staff,'GROUP_VIEW',filter.store?[filter.store]:[]);
   const p=(await loadStaff(c,staff.subject))!;
   const now=this.clock?this.clock():(await c.query<{now:Date}>('SELECT inventory_clock() AS now')).rows[0]!.now;
   const rows=(await c.query<GroupRow&{total_jpy:string|null;open_requests:string;received_jpy:string}>(`SELECT g.*,(SELECT total_jpy FROM group_quotes q WHERE q.group_id=g.id ORDER BY version DESC LIMIT 1) total_jpy,(SELECT count(*) FROM group_change_requests r WHERE r.group_id=g.id AND r.status='OPEN' AND r.kind<>'ADMIN_REQUEST') open_requests,(SELECT coalesce(sum(CASE kind WHEN 'RECEIPT' THEN amount_jpy ELSE -amount_jpy END),0) FROM group_payments p WHERE p.group_id=g.id) received_jpy FROM group_orders g WHERE g.pickup_store=ANY($1::text[]) AND g.return_store=ANY($1::text[]) AND ($2::text[] IS NULL OR g.status=ANY($2)) ORDER BY g.created_at,g.id LIMIT 500`,[filter.store?[filter.store]:p.storeIds,filter.status??null])).rows;
   const jst=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo'}).format(now);
   await c.query('COMMIT');
   return rows.map(g=>({id:g.id,groupNumber:g.group_number,status:g.status,label:g.group_label,memberCount:g.member_count,period:g.period,pickupStore:g.pickup_store,returnStore:g.return_store,createdAt:g.created_at,heldAt:g.held_at,daysHeld:g.held_at&&GROUP_HELD.includes(g.status)?Math.floor((now.getTime()-g.held_at.getTime())/86400000):null,
    startDatePassedDays:GROUP_HELD.includes(g.status)?Math.max(0,Math.round((Date.parse(jst)-Date.parse(g.period.startDate))/86400000)):0,openRequests:n(g.open_requests),totalJpy:g.total_jpy===null?null:n(g.total_jpy),confirmedTotalJpy:g.confirmed_total_jpy===null?null:n(g.confirmed_total_jpy),settlement:g.status==='CONFIRMED'?settlementOf(n(g.confirmed_total_jpy),[{kind:'RECEIPT',amountJpy:n(g.received_jpy)}]).status:null,occupiesInventory:GROUP_HELD.includes(g.status)}));
  }catch(e){await c.query('ROLLBACK').catch(()=>{});return this.normalize(e);}finally{c.release();}
 }

 // ------------------------------------------------------------------ administrator screen read models (thin, read-only)
 /** One read-only snapshot for the staff detail screen: the ordinary `detail` plus what only an administrator needs (payments,
  * open change requests, discount sets with before/after, notification delivery state, per-member price lines). ADMIN + GROUP_VIEW + store scope. */
 async staffDetail(staff:StaffActor,groupId:string){
  const c=await this.pool.connect();
  try{await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
   const g=(await c.query<GroupRow>('SELECT * FROM group_orders WHERE id=$1',[uuid(groupId)])).rows[0];if(!g)throw new GroupError('NOT_FOUND',404);
   await this.authStaff(c,staff,'GROUP_VIEW',[g.pickup_store,g.return_store]);
   const now=this.clock?this.clock():(await c.query<{now:Date}>('SELECT inventory_clock() AS now')).rows[0]!.now;
   const base=await this.detail(c,g,now,true);
   const payments=(await c.query('SELECT id,kind,amount_jpy::bigint AS "amountJpy",method,received_at AS "receivedAt",reverses_id AS "reversesId",reason,note,recorded_by AS "recordedBy",recorded_at AS "recordedAt" FROM group_payments WHERE group_id=$1 ORDER BY recorded_at,id',[g.id])).rows.map(r=>({...r,amountJpy:n(r.amountJpy)}));
   const changeRequests=(await c.query('SELECT id,kind,body,status,created_revision AS "createdRevision",created_at AS "createdAt" FROM group_change_requests WHERE group_id=$1 ORDER BY created_at,id',[g.id])).rows;
   const adjustmentRows=(await c.query('SELECT set_no AS "setNo",target,member_id AS "memberId",method,value,reason,actor,before_jpy::bigint AS "beforeJpy",after_jpy::bigint AS "afterJpy",occurred_at AS "occurredAt" FROM group_adjustments WHERE group_id=$1 AND set_no=(SELECT max(set_no) FROM group_adjustments WHERE group_id=$1) ORDER BY occurred_at,id',[g.id])).rows.map(r=>({...r,beforeJpy:n(r.beforeJpy),afterJpy:n(r.afterJpy)}));
   const notifications=(await c.query('SELECT event_type AS "eventType",status,attempt_count AS "attemptCount",last_safe_failure_code AS "failureCode",created_at AS "createdAt",sent_at AS "sentAt" FROM group_notification_outbox WHERE group_id=$1 ORDER BY created_at,id',[g.id])).rows;
   const est=(await c.query<QuoteRow>("SELECT * FROM group_quotes WHERE group_id=$1 AND kind='ESTIMATE' ORDER BY version DESC LIMIT 1",[g.id])).rows[0];
   const consent=est?(await c.query<{max_total_jpy:string}>('SELECT max_total_jpy FROM group_consents WHERE quote_id=$1',[est.id])).rows[0]:undefined;
   let pricing:null|{baseJpy:number;subtotalJpy:number;bundleDiscountJpy:number;memberDiscountJpy:number;groupDiscountJpy:number;totalJpy:number;members:{memberId:string;ordinal:number;baseJpy:number;memberDiscountJpy:number;groupDiscountJpy:number;finalJpy:number}[]}=null,pricingError:string|null=null;
   if(est&&['REVIEW_HELD','CHANGES_REQUESTED'].includes(g.status)){
    try{const {calc}=await this.groupBases(c,g,now);const q=await calc(await this.currentAdjustments(c,g.id));
     pricing={baseJpy:q.totals.baseJpy,subtotalJpy:q.subtotal,bundleDiscountJpy:q.bundle,memberDiscountJpy:q.member,groupDiscountJpy:q.group,totalJpy:q.total,members:q.totals.members.map(m=>({memberId:m.memberId,ordinal:m.ordinal,baseJpy:m.baseJpy,memberDiscountJpy:m.memberDiscountJpy,groupDiscountJpy:m.groupDiscountJpy,finalJpy:m.finalJpy}))};}
    catch(e){pricingError=e instanceof GroupError?e.code:'PRICING_FAILED';}
   }
   const confirmedLines=g.confirmed_quote_id?(await c.query<{lines:{memberId:string;ordinal:number;baseJpy:number;memberDiscountJpy:number;groupDiscountJpy:number;finalJpy:number}[]}>('SELECT lines FROM group_quotes WHERE id=$1',[g.confirmed_quote_id])).rows[0]?.lines??null:null;
   await c.query('COMMIT');
   return {...base,payments,changeRequests,adjustmentRows,notifications,pricing,pricingError,confirmedLines,consent:consent?{maxTotalJpy:n(consent.max_total_jpy)}:null,estimateVersion:est?.version??null,
    parts:base.parts};
  }catch(e){await c.query('ROLLBACK').catch(()=>{});return this.normalize(e);}finally{c.release();}
 }
 /** Read-only preview of a discount set (nothing is written). The same calculation `setAdjustments` and `confirm` use. */
 async previewAdjustments(staff:StaffActor,groupId:string,adjustments:Adjustment[]){
  if(!Array.isArray(adjustments)||adjustments.length>MAX_MEMBERS+1)throw new GroupError('ADJUSTMENT_INVALID');
  const c=await this.pool.connect();
  try{await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
   const g=(await c.query<GroupRow>('SELECT * FROM group_orders WHERE id=$1',[uuid(groupId)])).rows[0];if(!g)throw new GroupError('NOT_FOUND',404);
   await this.authStaff(c,staff,'GROUP_DISCOUNT',[g.pickup_store,g.return_store]);this.expectStatus(g,'REVIEW_HELD','CHANGES_REQUESTED');
   const now=this.clock?this.clock():(await c.query<{now:Date}>('SELECT inventory_clock() AS now')).rows[0]!.now;
   const {calc}=await this.groupBases(c,g,now);const q=await calc(adjustments);await c.query('COMMIT');
   return {revision:g.revision,baseJpy:q.totals.baseJpy,subtotalJpy:q.subtotal,bundleDiscountJpy:q.bundle,memberDiscountJpy:q.member,groupDiscountJpy:q.group,totalJpy:q.total,
    members:q.totals.members.map(m=>({memberId:m.memberId,ordinal:m.ordinal,baseJpy:m.baseJpy,memberDiscountJpy:m.memberDiscountJpy,groupDiscountJpy:m.groupDiscountJpy,finalJpy:m.finalJpy})),audit:q.totals.audit};
  }catch(e){await c.query('ROLLBACK').catch(()=>{});return this.normalize(e);}finally{c.release();}
 }
 /** Size/variant choices for the per-member edit (ledger variants of the families/age/tier used by this group). */
 async variantOptions(staff:StaffActor,groupId:string){
  const c=await this.pool.connect();
  try{await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
   const g=(await c.query<GroupRow>('SELECT * FROM group_orders WHERE id=$1',[uuid(groupId)])).rows[0];if(!g)throw new GroupError('NOT_FOUND',404);
   await this.authStaff(c,staff,'GROUP_VIEW',[g.pickup_store,g.return_store]);
   const rows=(await c.query<{id:string;family:string;age:string;tier:string;size:string;model:string}>(`SELECT v.id,v.family,v.age,v.tier,v.size,m.name AS model FROM ledger_variants v JOIN ledger_models m ON m.id=v.model_id WHERE v.family=ANY(SELECT DISTINCT i->>'family' FROM group_members gm,jsonb_array_elements(gm.selection->'items') i WHERE gm.group_id=$1) ORDER BY v.family,v.age,v.tier,v.size_key,m.name LIMIT 2000`,[g.id])).rows;
   await c.query('COMMIT');return rows;
  }catch(e){await c.query('ROLLBACK').catch(()=>{});return this.normalize(e);}finally{c.release();}
 }
 /** Entrance status for the administrator (the plain URL token is only ever returned by rotateEntrance, once). */
 async entranceStatus(staff:StaffActor){
  const c=await this.pool.connect();
  try{await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
   await this.authStaff(c,staff,'GROUP_ENTRANCE_MANAGE',STORES);
   const e=(await c.query<{enabled:boolean;generation:number;updated_at:Date}>('SELECT enabled,generation,updated_at FROM group_entrance WHERE id=1')).rows[0];
   const history=(await c.query('SELECT generation,action,reason,occurred_at AS "occurredAt" FROM group_entrance_history ORDER BY occurred_at DESC,generation DESC LIMIT 10')).rows;
   await c.query('COMMIT');return {configured:Boolean(e),enabled:e?.enabled??false,generation:e?.generation??0,updatedAt:e?.updated_at??null,history};
  }catch(e){await c.query('ROLLBACK').catch(()=>{});return this.normalize(e);}finally{c.release();}
 }
}
export const groupFingerprint=(v:unknown)=>createHash('sha256').update(canonical(v)).digest('hex');
