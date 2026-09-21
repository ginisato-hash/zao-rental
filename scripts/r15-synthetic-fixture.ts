import type {Pool} from 'pg';
import {flowHash} from '../packages/contracts/src/rental-flow';
import {normalizePeriod} from '../packages/contracts/src/hold';
import {stateFixture} from '../tests/fixtures/payment-projection';
export const r15FixtureId=(n:number)=>'15000000-0000-4000-8000-'+String(n).padStart(12,'0');
const id=r15FixtureId;
/** One explicit setup-owner seed in the retained Sandbox development DB only.
 * Uses isolated synthetic IDs and catalog/claims; never rewrites test or live rows. */
export async function seedR15SyntheticFixture(p:Pool,locationId:string){
 if(!/^[A-Za-z0-9_-]{1,100}$/.test(locationId))throw Error('R15_LOCATION_REQUIRED');
 if((await p.query('SELECT current_database() AS name')).rows[0].name!=='zr_852b20c4d4b0')throw Error('R15_DATABASE_REQUIRED');
 const merchantId='MLKDVEDH1ME21',providerId=null;
 if((await p.query('SELECT 1 FROM rental_bookings WHERE id=$1',[id(1)])).rowCount)throw Error('R15_FIXTURE_ALREADY_EXISTS');
 const c=await p.connect(),s=JSON.parse(JSON.stringify(stateFixture()).replaceAll('00000000-0000-4000-8000-','15000000-0000-4000-8000-')) as ReturnType<typeof stateFixture>,period=normalizePeriod(s.booking.conditions.period);s.booking.priceHash=flowHash(s.booking.priceSnapshot);try{await c.query('BEGIN');
 await c.query("SELECT set_config('zao.actor','synthetic-r15-actor',true),set_config('zao.reason','R15 SYNTHETIC 100 JPY test fixture',true)");
 await c.query(`INSERT INTO auth_user(id,name,email,"createdAt","updatedAt") VALUES('synthetic-r15-actor','SYNTHETIC R15','synthetic-r15@example.invalid',now(),now())`);
 await c.query("INSERT INTO staff_members(id,active,role,scope) VALUES('synthetic-r15-actor',false,'VIEWER','ASSIGNED')");
 for(const [n,family] of [[6,'SKI'],[7,'WEAR_JACKET'],[8,'WEAR_PANTS']] as const){
  await c.query(`INSERT INTO ledger_models(id,code,name,brand,family,notes,source_kind,source_document,source_locator,catalog_season) VALUES($1,$2,$2,'SYNTHETIC',$3,'SYNTHETIC only','SYNTHETIC','scripts/r15-synthetic-fixture.ts',$2,'2034/35')`,[id(n+30),'R15-'+family,family]);
  await c.query(`INSERT INTO ledger_variants(id,model_id,family,age,tier,size,notes,source_kind,source_document,source_locator,compatible_sports) VALUES($1,$2,$3,'ADULT',$4,$5,'','SYNTHETIC','scripts/r15-synthetic-fixture.ts',$3,$6)`,[id(n),id(n+30),family,n===6?'REGULAR':'STANDARD',n===6?'150 cm':'M',n===6?null:['SKI','SNOWBOARD']]);
  if(n===6)await c.query(`INSERT INTO ledger_assets(id,variant_id,family,initial_store_id,store_id,status,bsl_status,bsl_evidence,notes,source_kind,source_document,source_locator) VALUES($1,$2,'SKI','MOUNTAIN_BASE','MOUNTAIN_BASE','AVAILABLE','NOT_APPLICABLE','','','SYNTHETIC','scripts/r15-synthetic-fixture.ts','one pair')`,[id(50),id(n)]);
  else await c.query("INSERT INTO wear_pools(id,variant_id,store_id,ready) VALUES($1,$2,'MOUNTAIN_BASE',2)",[id(n+50),id(n)]);
 }
 await c.query("INSERT INTO inventory_reservations VALUES($1,'synthetic-r15-actor')",[id(1)]);
 await c.query(`INSERT INTO inventory_holds(id,reservation_id,owner_id,pickup_store,return_store,conditions,starts_at,due_at,occupancy_start,occupancy_end,expires_at,state,payment_state) VALUES($1,$2,'synthetic-r15-actor','MOUNTAIN_BASE','ONSEN_BASE',$3,$4,$5,'2035-01-01','2035-01-01',$6,'ACTIVE','PENDING')`,[id(2),id(1),s.booking.conditions,period.startsAt,period.dueAt,s.hold!.expiresAt]);
 await c.query("INSERT INTO inventory_claims(hold_id,requirement_key,asset_id,day) VALUES($1,'one:SKI',$2,'2035-01-01')",[id(2),id(50)]);
 for(const [n,f]of [[7,'WEAR_JACKET'],[8,'WEAR_PANTS']] as const)await c.query('INSERT INTO wear_claims(hold_id,requirement_key,pool_id,day,quantity) VALUES($1,$2,$3,$4,1)',[id(2),'one:'+f,id(n+50),'2035-01-01']);
 await c.query("INSERT INTO price_books(id,created_by,source_sha256,table_jpy,state,rental_from,rental_until) VALUES($1,'synthetic-r15-actor',$2,'{}','PRIVATE_AVAILABLE','2035-01-01','2035-12-31')",[id(60),flowHash('R15 SYNTHETIC 100 JPY')]);
 const prior=(await c.query('SELECT id FROM price_activations ORDER BY effective_at DESC LIMIT 1')).rows[0];
 if(prior?.id!=='00000000-0000-4000-8000-000000000061')throw Error('R15_SYNTHETIC_PRICE_PREDECESSOR_REQUIRED');
 await c.query("INSERT INTO price_activations(id,book_id,effective_at,predecessor_id) VALUES($1,$2,'2025-01-02',$3)",[id(61),id(60),prior.id]);
 await c.query(`INSERT INTO price_quotes(id,actor,request_key,request_fingerprint,book_id,activation_id,hold_id,hold_version,conditions,snapshot,snapshot_sha256,expires_at) VALUES($1,'synthetic-r15-actor',$2,$3,$4,$5,$6,1,$7,$8,$9,$10)`,[id(3),id(62),flowHash('R15 quote'),id(60),id(61),id(2),s.booking.conditions,s.booking.priceSnapshot,s.booking.priceHash,s.hold!.expiresAt]);
 await c.query(`INSERT INTO rental_bookings(id,owner_id,request_key,fingerprint,hold_id,quote_id,conditions,price_snapshot,price_sha256,contact,mode,state,version) VALUES($1,'synthetic-r15-actor',$2,$3,$4,$5,$6,$7,$8,$9,'SQUARE_SANDBOX','PAYMENT_PENDING',2)`,[id(1),id(63),flowHash('R15 booking'),id(2),id(3),s.booking.conditions,s.booking.priceSnapshot,s.booking.priceHash,{displayName:'SYNTHETIC R15',email:'synthetic-r15@example.invalid',termsAccepted:true}]);
 await c.query(`INSERT INTO rental_payment_attempts(id,booking_id,actor,idempotency_key,merchant_id,location_id,amount_jpy,currency,state,provider_id) VALUES($1,$2,'synthetic-r15-actor',$3,$4,$7,100,'JPY',$5,$6)`,[id(4),id(1),id(5),merchantId,providerId===null?'SUBMITTING':'PENDING',providerId,locationId]);
 await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
