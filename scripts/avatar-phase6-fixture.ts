import {createHash} from 'node:crypto';
import type {Pool} from 'pg';
import source from '../config/pricing/zao-2026-27-v1.draft.json';
import {INITIAL_TABLE,validateTable} from '../packages/contracts/src/pricing';
import {canonical} from '../packages/contracts/src/hold';
import {phase6Database} from '../packages/auth/src/hosted-preview-config';
import {phase6NeonHostname,proveNeonClientTls} from '../packages/db/src/neon-tls';
import {worktreeIdentity,rejectAmbientDatabase} from './worktree';
export const phase6Id=(n:number)=>'60000000-0000-4000-8000-'+String(n).padStart(12,'0');
export const phase6PoleVariant=phase6Id(30);
/** Owner setup only: append clearly synthetic private development catalog/pricing.
 * Never reset a table, rewrite inventory_clock, modify historical rows or create a booking. */
export async function seedPhase6Fixture(pool:Pool){
 const local=pool.options.host==='127.0.0.1';if(process.env.NODE_ENV==='production')throw Error('PHASE6_SETUP_NOT_RUNTIME');
 if(local){rejectAmbientDatabase();const i=worktreeIdentity();if(pool.options.database!==i.database||pool.options.user!==i.user||pool.options.port!==i.dbPort)throw Error('PHASE6_OWNED_LOCAL_REQUIRED');}
 else if(pool.options.host!==phase6NeonHostname||pool.options.database!==phase6Database||pool.options.user!=='neondb_owner')throw Error('PHASE6_SETUP_OWNER_REQUIRED');
 validateTable(INITIAL_TABLE);const c=await pool.connect();
 try{
  if(!local)proveNeonClientTls(c,pool.options);
  await c.query('BEGIN');await c.query("SET LOCAL lock_timeout='1500ms';SET LOCAL statement_timeout='5000ms'");
  await c.query('SELECT pg_advisory_xact_lock(71820800)');
  if((await c.query("SELECT 1 FROM ledger_models WHERE code LIKE 'P6-%' UNION ALL SELECT 1 FROM auth_user WHERE id='synthetic-avatar-phase6'" )).rowCount)throw Error('PHASE6_EXISTING_FIXTURE_RECONCILE');
  const previous=(await c.query('SELECT id FROM price_activations ORDER BY effective_at DESC LIMIT 1')).rows[0]?.id??null;
  if(!local&&previous!=='15000000-0000-4000-8000-000000000061')throw Error('PHASE6_UNEXPECTED_PRICE_PREDECESSOR');
  await c.query("SELECT set_config('zao.actor','synthetic-avatar-phase6',true),set_config('zao.reason','SYNTHETIC AVATAR PHASE6 protected Preview fixture',true)");
  await c.query(`INSERT INTO auth_user(id,name,email,"createdAt","updatedAt") VALUES('synthetic-avatar-phase6','SYNTHETIC PHASE6','synthetic-avatar-phase6@example.invalid',now(),now())`);
  await c.query("INSERT INTO staff_members(id,active,role,scope) VALUES('synthetic-avatar-phase6',false,'VIEWER','ASSIGNED')");
  for(const [n,family]of [[1,'SKI'],[2,'SKI_BOOT'],[3,'POLE']]as const)await c.query(`INSERT INTO ledger_models(id,code,name,brand,family,notes,source_kind,source_document,source_locator,catalog_season) VALUES($1,$2,$2,'SYNTHETIC',$3,'SYNTHETIC only','SYNTHETIC','scripts/avatar-phase6-fixture.ts',$2,'2034/35')`,[phase6Id(n),'P6-'+family,family]);
  const specs=[...([145,150,155,160,165,170,175]as const).map((size,i)=>({n:10+i,model:1,family:'SKI',size})),{n:20,model:2,family:'SKI_BOOT',size:26.5},{n:30,model:3,family:'POLE',size:110}];
  for(const s of specs){
   await c.query(`INSERT INTO ledger_variants(id,model_id,family,age,tier,size,notes,source_kind,source_document,source_locator) VALUES($1,$2,$3,'ADULT','REGULAR',$4,'SYNTHETIC only','SYNTHETIC','scripts/avatar-phase6-fixture.ts',$5)`,[phase6Id(s.n),phase6Id(s.model),s.family,s.size+' cm','variant-'+s.n]);
   if(s.family==='POLE')await c.query(`INSERT INTO ledger_poles(id,variant_id,store_id,quantity,status,notes,source_kind,source_document,source_locator) VALUES($1,$2,'MOUNTAIN_BASE',8,'AVAILABLE','SYNTHETIC only','SYNTHETIC','scripts/avatar-phase6-fixture.ts','pole-pairs')`,[phase6Id(300),phase6Id(s.n)]);
   else for(let j=0;j<4;j++)await c.query(`INSERT INTO ledger_assets(id,variant_id,family,initial_store_id,store_id,status,bsl_status,bsl_evidence,notes,source_kind,source_document,source_locator) VALUES($1,$2,$3,'MOUNTAIN_BASE','MOUNTAIN_BASE','AVAILABLE',$4,'','SYNTHETIC only','SYNTHETIC','scripts/avatar-phase6-fixture.ts',$5)`,[phase6Id(1000+s.n*10+j),phase6Id(s.n),s.family,s.family==='SKI_BOOT'?'UNVERIFIED':'NOT_APPLICABLE','asset-'+s.n+'-'+j]);
  }
  const clock=(await c.query('SELECT inventory_clock() now')).rows[0].now as Date;
  await c.query(`INSERT INTO price_books(id,created_by,source_sha256,table_jpy,state,rental_from,rental_until) VALUES($1,'synthetic-avatar-phase6',$2,$3,'PRIVATE_AVAILABLE','2026-01-01','2035-12-31')`,[phase6Id(60),createHash('sha256').update(canonical(source)).digest('hex'),JSON.stringify(INITIAL_TABLE)]);
  await c.query('INSERT INTO price_activations(id,book_id,effective_at,predecessor_id) VALUES($1,$2,$3,$4)',[phase6Id(61),phase6Id(60),clock,previous]);
  await c.query('COMMIT');return {status:'PASS',classification:'SYNTHETIC_AVATAR_PHASE6',modelCount:3,variantCount:9,assetCount:32,polePairs:8,previousPriceActivation:previous,priceBook:phase6Id(60),priceActivation:phase6Id(61),setupActorActive:false,existingRowsChanged:0,bookingCreated:0,paymentCreated:0,inventoryClockChanged:false};
 }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
}
