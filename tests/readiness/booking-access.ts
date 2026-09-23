import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {flowFixture,simulation} from '../flow/fixture';
import {skiSet,variants} from '../inventory/fixture';
import {provisionGuestRole} from '../../scripts/guest-roles';
import {provisionBookingAccessRole} from '../../scripts/booking-access-role';
import {GuestContexts,guestCookie} from '../../packages/core/src/guest/context';
import {BookingAccess,bookingAccessCookie} from '../../packages/core/src/guest/booking-access';
import {HoldService} from '../../packages/core/src/inventory/hold-service';
import {QuoteService} from '../../packages/core/src/pricing/quote-service';
import {BookingService} from '../../packages/core/src/payment/booking-service';
import {bookingAccessHandler} from '../../apps/web/src/lib/booking-access-http';
const x=await flowFixture();let guest:Awaited<ReturnType<typeof provisionGuestRole>>|undefined,role:Awaited<ReturnType<typeof provisionBookingAccessRole>>|undefined,failed=false,stage='setup',count=0;
async function check(name:string,fn:()=>Promise<void>){stage=name;await fn();count++;console.log('PASS '+name);}
try{
 guest=await provisionGuestRole(x.db.pool,x.db.identity);role=await provisionBookingAccessRole(x.db.pool,x.db.identity);
 const contexts=new GuestContexts(guest.guestPool),session=await contexts.create(),actor=await contexts.resolve(session.token),other=await contexts.resolve((await contexts.create()).token),access=new BookingAccess(role.accessPool,randomBytes(32),'test-v1');
 const holds=new HoldService(x.roles.holdPool,actor),quotes=new QuoteService(x.roles.pricingPool,actor),bookings=new BookingService(x.flow.flowPool,guest.guestPool,actor,x.fake,simulation);
 // PUBLIC BOOKING POLICY test (genuine guest actor — structurally can never request
 // bufferOverride): the shared seedInventory fixture's SKI/SKI_BOOT/POLE variants get an ample
 // local top-up (this file's own isolated database only, not the shared fixture module) purely so
 // an ordinary guest booking — the actual thing under test — isn't incidentally blocked by the
 // public capacity ceiling on a 1-unit variant. A dedicated held connection is required: set_config
 // is connection-local and separate pool.query() calls are not guaranteed the same connection.
 {
  const c=await x.db.pool.connect();
  try{
   await c.query('BEGIN');
   await c.query("SELECT set_config('zao.actor',$1,true),set_config('zao.reason','SYNTHETIC P4 booking-access fixture top-up',true)",[x.actor]);
   for(const [family,variant] of [['SKI',variants.ski],['SKI_BOOT',variants.boot]] as const)for(let n=0;n<20;n++)await c.query(`INSERT INTO ledger_assets(id,variant_id,family,initial_store_id,store_id,status,bsl_status,bsl_mm,bsl_evidence,notes,source_kind,source_document,source_locator) VALUES($1,$2,$3,'MOUNTAIN_BASE','MOUNTAIN_BASE','AVAILABLE',$4,NULL,'','','SYNTHETIC','tests/readiness/booking-access.ts',$5) ON CONFLICT DO NOTHING`,[randomUUID(),variant,family,family==='SKI_BOOT'?'UNVERIFIED':'NOT_APPLICABLE','asset-p4-'+family+'-'+n]);
   await c.query('UPDATE ledger_poles SET quantity=20 WHERE variant_id=$1',[variants.pole]);
   await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 }
 const conditions=skiSet('2035-02-05'),h=await holds.command('create',randomUUID(),conditions),quote=(await quotes.create(randomUUID(),{conditions,holdId:h.holdId,couponCode:null,wantAdvance:false})).quote;
 const booking=await bookings.create(randomUUID(),quote.id,{displayName:'SYNTHETIC Capability',email:'synthetic-capability@example.invalid',termsAccepted:true});
 await check('unconfirmed and foreign owner cannot issue capability',async()=>{await assert.rejects(access.issue(actor,booking.id,randomUUID()),{code:'BOOKING_ACCESS_DENIED'});await bookings.startPayment(booking.id,randomUUID());await assert.rejects(access.issue(other,booking.id,randomUUID()),{code:'BOOKING_ACCESS_DENIED'});});
 const request=randomUUID();let token='';const before=(await x.db.pool.query('SELECT b.conditions,b.price_snapshot,b.price_sha256,h.expires_at,h.due_at,h.confirmed_at FROM rental_bookings b JOIN inventory_holds h ON h.id=b.hold_id WHERE b.id=$1',[booking.id])).rows[0];
 await check('hash-only issuance, exact-key replay and immutable booking/HOLD',async()=>{const a=await access.issue(actor,booking.id,request),b=await access.issue(actor,booking.id,request);assert.equal(a.replayed,false);assert.equal(b.replayed,true);assert.equal(a.token,b.token);assert.equal(a.token.length,43);token=a.token;assert.equal(a.expiresAt,before.due_at.toISOString());const rows=(await x.db.pool.query('SELECT * FROM booking_access.capabilities')).rows;assert.equal(rows.length,1);assert.equal(rows[0].token_sha256,createHash('sha256').update(token).digest('hex'));assert.equal(JSON.stringify(rows).includes(token),false);const after=(await x.db.pool.query('SELECT b.conditions,b.price_snapshot,b.price_sha256,h.expires_at,h.due_at,h.confirmed_at FROM rental_bookings b JOIN inventory_holds h ON h.id=b.hold_id WHERE b.id=$1',[booking.id])).rows[0];assert.deepEqual(after,before);});
 await check('concurrent issue rotates atomically; old-key replay never resurrects revoked capability',async()=>{const [a,b]=await Promise.all([access.issue(actor,booking.id,randomUUID()),access.issue(actor,booking.id,randomUUID())]);const ok=await Promise.allSettled([access.read(a.token),access.read(b.token)]);assert.equal(ok.filter(v=>v.status==='fulfilled').length,1);token=ok[0]!.status==='fulfilled'?a.token:b.token;await assert.rejects(access.issue(actor,booking.id,request),{code:'BOOKING_ACCESS_DENIED'});assert.equal((await x.db.pool.query('SELECT count(*)::int n FROM booking_access.capabilities WHERE revoked_at IS NULL')).rows[0].n,1);});
 const handler=bookingAccessHandler(access,contexts,x.origin);const url=x.origin+'/api/booking-access';
 await check('HttpOnly/cookie-only response-loss replay and CSRF/query restrictions',async()=>{
  const key=randomUUID(),req=()=>new Request(url+'/issue',{method:'POST',headers:{origin:x.origin,cookie:guestCookie(session.token,false),'content-type':'application/json'},body:JSON.stringify({bookingId:booking.id,requestId:key})});
  const a=await handler(req()),b=await handler(req());assert.equal(a.status,200);assert.equal(b.status,200);const first=a.headers.get('set-cookie')!,second=b.headers.get('set-cookie')!;assert.equal(first,second);token=first.split(';')[0]!.split('=')[1]!;assert.equal(JSON.stringify(await b.json()).includes(token),false);assert.match(first,/HttpOnly; SameSite=Strict/);assert.match(first,/Path=\/api\/booking-access/);assert.match(bookingAccessCookie(token,true,600),/; Secure$/);assert.equal((await handler(new Request(url+'/revoke',{method:'POST',headers:{origin:'https://attacker.invalid'},body:'{}'}))).status,403);assert.equal((await handler(new Request(url+'?bookingId='+booking.id))).status,422);
 });
 await check('dedicated DB connection has only three functions and no table or inventory writes',async()=>{for(const sql of ['SELECT contact FROM rental_bookings','SELECT * FROM guest_contexts','SELECT * FROM booking_access.capabilities','UPDATE inventory_holds SET expires_at=expires_at','DELETE FROM booking_access.audit','CREATE TABLE public.capability_escape(id int)'])await assert.rejects(role!.accessPool.query(sql),(e:{code?:string})=>e.code==='42501');const rights=(await x.db.pool.query('SELECT rolcreaterole,rolsuper,rolcreatedb,rolbypassrls FROM pg_roles WHERE rolname=$1',[role!.accessDb.user])).rows[0];assert.ok(Object.values(rights).every(v=>v===false));});
 await check('issuance blocked on booking lock rechecks guest expiry before writing',async()=>{
  const c=await x.db.pool.connect();let pending:Promise<unknown>|undefined;
  try{await c.query('BEGIN');await c.query('SELECT 1 FROM rental_bookings WHERE id=$1 FOR UPDATE',[booking.id]);
   pending=assert.rejects(access.issue(actor,booking.id,randomUUID()),{code:'BOOKING_ACCESS_DENIED'});
   let waiting=false;for(let i=0;i<100;i++){waiting=(await x.db.pool.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE usename=$1 AND wait_event_type='Lock') ok",[role!.accessDb.user])).rows[0].ok;if(waiting)break;await new Promise(r=>setTimeout(r,10));}assert.ok(waiting,'synchronized PostgreSQL lock wait observed');
   await x.clock('2035-01-02T10:00:00+09:00');await c.query('COMMIT');await pending;
  }finally{await c.query('ROLLBACK');c.release();if(pending)await pending;}
  await x.clock('2035-01-01T10:00:00+09:00');
 });
 await check('context revoked/absolute TTL passed: booking read survives, write/issue does not',async()=>{await contexts.revoke(actor);await x.clock('2035-02-05T10:00:00+09:00');const v=await access.read(token);assert.equal(v.id,booking.id);assert.equal(v.readOnly,true);assert.equal(v.chargeReady,false);assert.equal(v.dueAt,before.due_at.toISOString());assert.equal('contact' in v,false);assert.equal('members' in v,false);assert.equal((await handler(new Request(url,{headers:{cookie:bookingAccessCookie(token,false,600)}}))).status,200);await assert.rejects(access.issue(actor,booking.id,randomUUID()),{code:'BOOKING_ACCESS_DENIED'});const unchanged=(await x.db.pool.query('SELECT expires_at,confirmed_at FROM inventory_holds WHERE id=$1',[h.holdId])).rows[0];assert.equal(unchanged.expires_at.toISOString(),before.expires_at.toISOString());assert.ok(unchanged.confirmed_at);});
 await check('original return deadline expires access; read never extends it',async()=>{await x.clock('2035-02-05T16:59:59+09:00');assert.equal((await access.read(token)).id,booking.id);await x.clock('2035-02-05T17:00:00+09:00');await assert.rejects(access.read(token),{code:'BOOKING_ACCESS_DENIED'});});
 await check('revocation is idempotent and cannot alter stock/payment/booking',async()=>{await access.revoke(token);await access.revoke(token);assert.equal((await x.db.pool.query("SELECT count(*)::int n FROM booking_access.audit WHERE action='REVOKED'")).rows[0].n,1);await assert.rejects(access.read(randomBytes(32).toString('base64url')),{code:'BOOKING_ACCESS_DENIED'});assert.equal((await x.db.pool.query('SELECT state FROM rental_bookings WHERE id=$1',[booking.id])).rows[0].state,'CONFIRMED_DEV');assert.equal(JSON.stringify((await x.db.pool.query('SELECT * FROM booking_access.audit')).rows).includes(token),false);});
 console.log('P4 booking access real PostgreSQL: '+count+' passed; no skip; no external calls.');
}catch(e){failed=true;console.error('P4_BOOKING_ACCESS_FAILED '+stage+' '+String((e as {code?:string}).code??(e as Error).name));console.error((e as Error).stack?.split('\n').filter(s=>s.includes('/tests/readiness/')).join('\n'));}finally{await role?.close();await guest?.close();await x.close();console.log('Owned P4 capability PostgreSQL stopped.');}if(failed)process.exit(1);
