import {Pool} from 'pg';
import {getRuntime} from '../../apps/web/src/lib/staff-runtime';
import {BookingService,type FlowIdentity} from '../../packages/core/src/payment/booking-service';
import {FlowError,type PaymentGateway,type PaymentObservation,type PaymentRequest} from '../../packages/contracts/src/rental-flow';
import type {Connection} from '../../packages/auth/src/config';
// Only tests/flow-app imports this. Normal apps/web routing never imports a fake gateway.
const receipts=new Map<string,PaymentObservation>();let pool:Pool|undefined;
function setup(){if(process.env.NODE_ENV!=='development')throw new FlowError('TEST_COMPOSITION_FORBIDDEN',503);const r=getRuntime();if(!r)throw new FlowError('TEST_COMPOSITION_MISSING',503);const db=JSON.parse(process.env.ZAO_TEST_FLOW_RUNTIME??'null') as Connection|null;if(!db||db.host!=='127.0.0.1'||db.database!==r.config.namespace||db.user!==r.config.namespace+'_flow'||db.port!==r.config.authDb.port||!db.password)throw new FlowError('TEST_COMPOSITION_INVALID',503);if(!pool){pool=new Pool({...db,max:4,connectionTimeoutMillis:2000});pool.on('error',()=>{});}return {r,pool};}
const gateway:PaymentGateway={kind:'SIMULATED_DEV',async create(request:PaymentRequest){const old=receipts.get(request.attemptId);if(old)return old;const {pool}=setup();const now=(await pool.query<{now:Date}>('SELECT inventory_clock() AS now')).rows[0]!.now.toISOString();const o:PaymentObservation={providerId:'sim_'+request.attemptId,referenceId:request.bookingId,idempotencyKey:request.idempotencyKey,merchantId:request.merchantId,locationId:request.locationId,amountJpy:request.amountJpy,currency:request.currency,status:'COMPLETED',updatedAt:now,completedAt:now};receipts.set(request.attemptId,o);return o;},async lookup(request){return receipts.get(request.attemptId)??null;}};
export function testFlowService(identity:FlowIdentity){const {r,pool}=setup();return new BookingService(pool,r.authPool,identity,gateway,{merchantId:'SYNTHETIC-MERCHANT',locations:{MOUNTAIN_BASE:'SYNTHETIC-MOUNTAIN',ONSEN_BASE:'SYNTHETIC-ONSEN'},nodeEnv:'development'});}
export function testFlowOrigin(){return setup().r.config.origin;}
