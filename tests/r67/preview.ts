// Local R67 visual-review server (synthetic data only; never deployed). Production-copy flow app with
// the accepted Source A/B provisional payloads, the R67 catalog bridge, a WEAR catalog and the private
// price book, so the public pages and the booking flow show real provisional-backed candidates.
import {randomBytes,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {startFlowApp} from '../flow/launcher';
import {bootstrapDevelopmentAdmin} from '../../scripts/bootstrap-staff';
import {loadStaff} from '../../packages/auth/src/staff-auth';
import {QuoteService} from '../../packages/core/src/pricing/quote-service';
import {activateProvisionalCatalog} from '../../packages/core/src/operations/provisional-catalog-bridge';

const app=await startFlowApp({productionCopy:true,publicP0:true,publicP1:true,publicP4:true,publicP5:true});
try{
 const pool=app.db.pool;
 await pool.query("CREATE OR REPLACE FUNCTION inventory_clock() RETURNS timestamptz LANGUAGE sql VOLATILE AS $$SELECT '2035-01-10T10:00:00+09:00'::timestamptz$$");
 const root=await bootstrapDevelopmentAdmin(pool,{email:'r67-preview@example.invalid',displayName:'SYNTHETIC R67',password:randomBytes(24).toString('base64url')});
 for(const permission of ['PRICE_EDIT','QUOTE_VIEW'])await pool.query('INSERT INTO staff_permission_overrides(staff_id,permission,allowed) VALUES($1,$2,true) ON CONFLICT DO NOTHING',[root,permission]);
 await new QuoteService(app.roles.pricingPool,(await loadStaff(pool,root))!).initializePrivate(randomUUID(),'2035-01-01','2035-12-31');
 const c=await pool.connect();
 try{
  await c.query('BEGIN');await c.query("SELECT set_config('zao.actor',$1,true),set_config('zao.reason','SYNTHETIC R67 preview',true)",[root]);
  for(const n of ['A','B']){const p=JSON.parse(readFileSync('docs/execution/provisional-booking-capacity/ACTIVATION_PAYLOAD_SOURCE_'+n+'.json','utf8'));
   await c.query('SELECT provisional_capacity_register_source($1,$2,$3::jsonb)',[p.sourceSha256,p.originalFilename,JSON.stringify(p.buckets.map((b:{family:string;age:string;sourceSize:string;bookingSize:string|null;quantity:number;provenance:string})=>({family:b.family,age:b.age,source_size:b.sourceSize,booking_size:b.bookingSize,size_mapping_status:b.bookingSize===null?'UNRESOLVED':'MAPPED',quantity:b.quantity,provenance:b.provenance})))]);}
  for(const family of ['WEAR_JACKET','WEAR_PANTS']){const m=(await c.query("INSERT INTO ledger_models(code,name,brand,family,notes,source_kind,source_document,source_locator,catalog_season) VALUES($1,$1,'SALOMON',$2,'','SYNTHETIC','tests/r67/preview.ts',$1,'2026/27') RETURNING id",['R67-'+family.replace('_','-'),family])).rows[0].id;
   for(const size of ['S','M','L','XL'])for(const age of ['ADULT'])await c.query("INSERT INTO ledger_variants(model_id,family,age,tier,size,compatible_sports,notes,source_kind,source_document,source_locator) VALUES($1,$2,$3,'STANDARD',$4,ARRAY['SKI','SNOWBOARD'],'','SYNTHETIC','tests/r67/preview.ts',$5)",[m,family,age,size,family+'-'+age+'-'+size]);}
  console.log(JSON.stringify(await activateProvisionalCatalog(c)).slice(0,300));
  await c.query('COMMIT');
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 console.log('R67 PREVIEW READY '+app.origin);
 await new Promise<void>(resolve=>{process.once('SIGINT',()=>resolve());process.once('SIGTERM',()=>resolve());});
}finally{await app.stop();}
