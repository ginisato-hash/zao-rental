import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {migrate} from '../../packages/db/src/index';
import {startIsolatedPostgres} from '../../scripts/postgres';
import {provisionApplicationRoles} from '../../scripts/application-roles';
import {provisionFlowRole} from '../../scripts/flow-roles';
import {bootstrapDevelopmentAdmin} from '../../scripts/bootstrap-staff';
import {createStaffAuth,loadStaff} from '../../packages/auth/src/staff-auth';
import {writeAccount} from '../../packages/auth/src/accounts';
import {authHandler} from '../../apps/web/src/lib/auth-http';
import {seedRecommendation} from '../recommendation/fixture';
import {skiSet} from '../inventory/fixture';
import {HoldService} from '../../packages/core/src/inventory/hold-service';
import {QuoteService} from '../../packages/core/src/pricing/quote-service';
import {BookingService} from '../../packages/core/src/payment/booking-service';
import type {HoldConditions} from '../../packages/contracts/src/hold';
import type {PaymentGateway,PaymentObservation,PaymentRequest} from '../../packages/contracts/src/rental-flow';
export const simulation={merchantId:'SYNTHETIC-MERCHANT',locations:{MOUNTAIN_BASE:'SYNTHETIC-MOUNTAIN',ONSEN_BASE:'SYNTHETIC-ONSEN'},nodeEnv:'test'};
// Test-owned deterministic adapter; never imported by apps/web or normal runtime.
export class FakeGateway implements PaymentGateway{
 readonly kind='SIMULATED_DEV' as const;calls:PaymentRequest[]=[];receipts=new Map<string,PaymentObservation>();failAfterSave=false;status:PaymentObservation['status']='COMPLETED';patch:Partial<PaymentObservation>={};
 constructor(private now:()=>Date){}
 async create(r:PaymentRequest){this.calls.push(r);const old=this.receipts.get(r.attemptId);if(old)return old;const o:PaymentObservation={providerId:'sim_'+r.attemptId,referenceId:r.bookingId,idempotencyKey:r.idempotencyKey,merchantId:r.merchantId,locationId:r.locationId,amountJpy:r.amountJpy,currency:r.currency,status:this.status,updatedAt:this.now().toISOString(),completedAt:this.status==='COMPLETED'?this.now().toISOString():null,...this.patch};this.receipts.set(r.attemptId,o);if(this.failAfterSave)throw new Error('SIMULATED_RESPONSE_LOST');return o;}
 async lookup(r:PaymentRequest){return this.receipts.get(r.attemptId)??null;}
}
export async function flowFixture(){
 const db=await startIsolatedPostgres();let roles:Awaited<ReturnType<typeof provisionApplicationRoles>>|undefined,flow:Awaited<ReturnType<typeof provisionFlowRole>>|undefined;
 try{await migrate(db.pool);await seedRecommendation(db.pool);roles=await provisionApplicationRoles(db.pool,db.identity);flow=await provisionFlowRole(db.pool,db.identity);
 const password=randomBytes(24).toString('base64url'),origin='http://127.0.0.1:34567';let now=new Date('2035-01-01T10:00:00+09:00');
 async function clock(t:string){now=new Date(t);await db.pool.query(`CREATE OR REPLACE FUNCTION inventory_clock() RETURNS timestamptz LANGUAGE sql VOLATILE AS $$SELECT '${now.toISOString()}'::timestamptz$$`);}
 await clock(now.toISOString());const root=await bootstrapDevelopmentAdmin(db.pool,{email:'flow-root@example.invalid',displayName:'SYNTHETIC Admin',password}),bp=(await loadStaff(db.pool,root))!;
 // INVENTORY_BUFFER_OVERRIDE (release-code-closure): granting this ADMIN test actor the
 // permission is not the same as invoking it — every caller must still separately pass an
 // explicit {reason} to HoldService.command()/draft() below (both default to no override), so
 // existing tests keep exercising the ordinary public path unless they opt in. A test proving
 // the permission itself is enforced uses its own dedicated, deliberately unprivileged principal.
 const perms={BOOKING_VIEW:true,BOOKING_CREATE:true,RENTAL_CHECKOUT:true,RENTAL_RETURN:true,INVENTORY_VIEW:true,INVENTORY_EDIT:true,HOLD_VIEW:true,HOLD_EDIT:true,QUOTE_VIEW:true,QUOTE_CREATE:true,PRICE_EDIT:true,TRANSFER_VIEW:true,TRANSFER_PLAN:true,TRANSFER_DISPATCH:true,TRANSFER_RECEIVE:true,INVENTORY_BUFFER_OVERRIDE:true} as const;
 const actor=(await writeAccount(roles.authPool,bp,undefined,{email:'flow-actor@example.invalid',password,displayName:'SYNTHETIC Creator',active:true,role:'ADMIN',scope:'ALL',storeIds:[],permissions:perms})).id!,principal=(await loadStaff(db.pool,actor))!;
 const auth=createStaffAuth(roles.authPool,{origin,secret:randomBytes(32).toString('hex')}),handler=authHandler(auth,roles.authPool,origin,roles.authPool);
 async function login(email:string){const r=await handler(new Request(origin+'/api/auth/sign-in/email',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({email,password})}));assert.equal(r.status,200);const cookie=r.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');const subject=(await db.pool.query('SELECT id FROM staff_users WHERE email=$1',[email])).rows[0].id as string;const sessionId=(await db.pool.query('SELECT id FROM auth_session WHERE "userId"=$1 ORDER BY "createdAt" DESC LIMIT 1',[subject])).rows[0].id as string;return {cookie,identity:{subject,sessionId}};}
 const signed=await login('flow-actor@example.invalid'),fake=new FakeGateway(()=>now),service=new BookingService(flow.flowPool,roles.authPool,signed.identity,fake,simulation),holds=new HoldService(roles.holdPool,principal,()=>now),quotes=new QuoteService(roles.pricingPool,principal,()=>now);
 await quotes.initializePrivate(randomUUID(),'2035-01-01','2035-12-31');let serial=5;
 // `bufferOverride` defaults to undefined (no override, ordinary public path) for every existing
 // caller; a test proving lower-level exact-capacity/concurrency mechanics against a deliberately
 // scarce (sub-20-unit) synthetic pool opts in explicitly with {reason}, using this fixture's own
 // ADMIN principal (already granted INVENTORY_BUFFER_OVERRIDE above).
 async function draft(day?:string,supplied?:HoldConditions,bufferOverride?:{reason:string}){const conditions=supplied??skiSet(day??'2035-02-'+String(serial++).padStart(2,'0'));const h=await holds.command('create',randomUUID(),conditions,undefined,undefined,bufferOverride);assert.equal(h.result,'CREATED');const quote=(await quotes.create(randomUUID(),{conditions,holdId:h.holdId,couponCode:null,wantAdvance:false})).quote,key=randomUUID();const contact={displayName:'SYNTHETIC Guest',email:'synthetic-guest@example.invalid',termsAccepted:true};const booking=await service.create(key,quote.id,contact);return {conditions,holdId:h.holdId!,quote,key,contact,booking};}
 return {db,roles,flow,actor,principal,bp,password,auth,handler,origin,login,signed,fake,service,holds,quotes,draft,clock,now:()=>now,async close(){await flow!.close();await roles!.close();await db.stop();}};
 }catch(e){await flow?.close();await roles?.close();await db.stop();throw e;}
}
