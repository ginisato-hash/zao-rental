import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {migrate,migrationPlan,migrationsDirectory} from '../../packages/db/src/index';
import {startIsolatedPostgres} from '../../scripts/postgres';
import {bootstrapDevelopmentAdmin} from '../../scripts/bootstrap-staff';
import {provisionAvatarReadRole} from '../../scripts/avatar-read-role';
import {seedAvatarPhase4} from './phase4-fixture';
import {PostgresAvatarVisuals} from '../../packages/db/src/avatar-visuals';
import {id,visualGrant,visual} from './fixture';
import {planPrivateRelease,applyPersistedPrivateRelease} from '../../packages/core/src/content/release-plan';
const results:{name:string;status:'PASS'}[]=[];
let stage='setup',failed=false;
const check=async(name:string,fn:()=>Promise<void>)=>{stage=name;await fn();results.push({name,status:'PASS'});console.log('PASS '+name);};
const db=await startIsolatedPostgres();let role:Awaited<ReturnType<typeof provisionAvatarReadRole>>|undefined;
try{
 await check('0001–0031 original hashes unchanged; exactly one additive0032',async()=>{
  const hashes=JSON.parse(await readFile('docs/execution/avatar-phase4/migration-hashes.json','utf8')) as {file:string;sha256:string}[];
  assert.equal(migrationPlan.slice(0,32).length,32);assert.equal(hashes.length,31);
  for(const h of hashes)assert.equal(createHash('sha256').update(await readFile(h.file)).digest('hex'),h.sha256);
 });
 for(const m of migrationPlan.slice(0,31)){
  const sql=await readFile(migrationsDirectory+'/'+m.file,'utf8');await db.pool.query(sql);
  await db.pool.query('CREATE TABLE IF NOT EXISTS foundation_migrations(id text PRIMARY KEY,checksum text NOT NULL)');
  await db.pool.query('INSERT INTO foundation_migrations VALUES($1,$2)',[m.id,createHash('sha256').update(sql).digest('hex')]);
 }
 const subject=await bootstrapDevelopmentAdmin(db.pool,{email:'avatar-upgrade@example.invalid',displayName:'SYNTHETIC Upgrade',password:randomBytes(24).toString('base64url')});
 const seed=await seedAvatarPhase4(db.pool,subject),v=seed.metadata[0]!;
 const fingerprint=async()=>{const values:Record<string,unknown>={};for(const table of ['avatar_visuals','content_workspace','content_revision_records','content_media_objects','recommendation_previews','guest_drafts','inventory_holds','price_quotes','rental_bookings','rental_payment_attempts'])values[table]=(await db.pool.query(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]') AS value FROM ${table} t`)).rows[0].value;return values;};
 await check('populated0031 upgrades without rewriting existing visual/content/business rows',async()=>{const before=await fingerprint();await migrate(db.pool);assert.equal((await db.pool.query('SELECT count(*)::int n FROM foundation_migrations')).rows[0].n,migrationPlan.length);assert.deepEqual(await fingerprint(),before);});
 for(const [field,value] of [['id',id(900)],['layer','SKI'],['avatar_type','APPEARANCE_2'],['match_kind','EXACT_PROMISE'],['model_id',id(901)],['variant_id',id(902)],['season','2035/36'],['ski_length_cm',170],['media_id','other-media'],['derivative_sha256',seed.originalHash],['revision_id',id(903)],['release_id',id(904)],['created_at','2001-01-01']] as const){
  await check('binding immutable: '+field,async()=>{await assert.rejects(db.pool.query(`UPDATE avatar_visuals SET ${field}=$1 WHERE id=$2`,[value,v.id]),{code:'23514'});});
 }
 await check('state and normalized presentation remain editable',async()=>{await db.pool.query("UPDATE avatar_visuals SET state='DISABLED',sort_order=7,anchor_x=0.4,position_x=0.4 WHERE id=$1",[v.id]);const row=(await db.pool.query('SELECT state,sort_order,anchor_x FROM avatar_visuals WHERE id=$1',[v.id])).rows[0];assert.deepEqual(row,{state:'DISABLED',sort_order:7,anchor_x:0.4});await db.pool.query("UPDATE avatar_visuals SET state='ACTIVE',sort_order=$2,anchor_x=0.5,position_x=0.5 WHERE id=$1",[v.id,v.sortOrder]);});
 role=await provisionAvatarReadRole(db.pool,db.identity);const reader=new PostgresAvatarVisuals(role.avatarPool);
 await check('dedicated narrow reader resolves current metadata and only granted bytes',async()=>{assert.equal((await reader.read([],new Date())).length,6);assert.ok(await reader.readBytes(v.id,v.derivativeSha256));assert.equal(await reader.readBytes(v.id,seed.originalHash),null);assert.equal(await reader.readBytes(id(999),v.derivativeSha256),null);});
 for(const [name,sql] of [
  ['workspace JSON','SELECT value FROM content_workspace'],['raw media bytes','SELECT bytes FROM content_media_objects'],['immutable revisions','SELECT payload FROM content_revision_records'],['unfiltered visual metadata','SELECT * FROM avatar_visuals'],['guest credentials','SELECT token_sha256 FROM guest_contexts'],['saved business preview','SELECT input FROM recommendation_previews'],
  ['visual update',"UPDATE avatar_visuals SET state='DISABLED'"],['business delete','DELETE FROM inventory_holds'],['workspace update','UPDATE content_workspace SET revision=revision+1'],['DDL','CREATE TABLE forbidden_avatar(id int)'],
 ] as const)await check('narrow role rejects '+name,async()=>{await assert.rejects(role!.avatarPool.query(sql),{code:'42501'});});
 await check('metadata view is not writable and UPDATE privilege is absent',async()=>{assert.equal((await role!.avatarPool.query("SELECT has_table_privilege(current_user,'avatar_current_visuals','UPDATE') AS allowed")).rows[0].allowed,false);await assert.rejects(role!.avatarPool.query("UPDATE avatar_current_visuals SET state='DISABLED'"),{code:'55000'});});
 await check('PUBLIC cannot call byte function; search_path and role cannot escalate',async()=>{
  const rows=(await db.pool.query("SELECT prosecdef,proconfig,EXISTS(SELECT 1 FROM aclexplode(proacl) a WHERE grantee=0 AND privilege_type='EXECUTE') AS public_execute FROM pg_proc WHERE oid='avatar_visual_derivative(uuid,text)'::regprocedure")).rows;
  assert.equal(rows.length,1);assert.equal(rows[0].prosecdef,true);assert.equal(rows[0].public_execute,false);assert.deepEqual(rows[0].proconfig,['search_path=pg_catalog, public, pg_temp']);
  const flags=(await db.pool.query('SELECT rolsuper,rolcreatedb,rolcreaterole,rolinherit,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=$1',[role!.avatarDb.user])).rows[0];assert.ok(Object.values(flags).every(v=>v===false));
  assert.equal((await db.pool.query('SELECT count(*)::int n FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname=$1)',[role!.avatarDb.user])).rows[0].n,0);
 });
 await check('qualified derivative function resists temporary-table shadowing',async()=>{
  const c=await role!.avatarPool.connect();try{await c.query('CREATE TEMP TABLE content_media_objects(sha256 text,bytes bytea)');await c.query('INSERT INTO content_media_objects VALUES($1,$2)',[v.derivativeSha256,Buffer.from('SYNTHETIC FORGED')]);const bytes=(await c.query('SELECT public.avatar_visual_derivative($1,$2) AS bytes',[v.id,v.derivativeSha256])).rows[0].bytes;assert.equal(createHash('sha256').update(bytes).digest('hex'),v.derivativeSha256);await c.query('DROP TABLE pg_temp.content_media_objects');}finally{c.release();}
 });
 await check('narrow view preserves exact PREMIUM variant/season/length and new immutable release binding',async()=>{
  const c=await db.pool.connect();try{await c.query('BEGIN');await c.query("SELECT set_config('zao.actor','synthetic-avatar-phase5',true),set_config('zao.reason','SYNTHETIC exact fixture',true)");await c.query("INSERT INTO ledger_models(id,code,name,brand,family,notes,source_kind,source_document,source_locator,catalog_season) VALUES($1,'AVATAR-PHASE5','Synthetic exact ski','SYNTHETIC','SKI','','SYNTHETIC','tests/avatar/phase5-upgrade.ts','model','2035/36')",[id(70)]);await c.query("INSERT INTO ledger_variants(id,model_id,family,age,tier,size,notes,source_kind,source_document,source_locator) VALUES($1,$2,'SKI','ADULT','PREMIUM','150 cm','','SYNTHETIC','tests/avatar/phase5-upgrade.ts','premium')",[id(71),id(70)]);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  const ski=seed.metadata.find(m=>m.layer==='SKI')!,exact=visual(107,{match:'EXACT_PROMISE',modelId:id(70),variantId:id(71),season:'2035/36',skiLengthCm:150,mediaId:ski.mediaId,derivativeSha256:ski.derivativeSha256,revisionId:id(192),releaseId:id(193)});
  const state=structuredClone(seed.state),revision={...state.catalog.revisions[0]!,id:id(192),avatarVisualUses:[visualGrant(exact)]};state.catalog.revisions.push(revision);state.catalog.draftIds['synthetic-avatar-phase4/ja']=revision.id;
  const plan=planPrivateRelease(state.catalog,{id:id(193),entries:[revision.id],expectedCurrent:state.catalog.current,restoreOf:null},new Date());assert.deepEqual(plan.issues,[]);state.catalog=applyPersistedPrivateRelease(state.catalog,plan,new Date()).state;
  await db.pool.query('INSERT INTO content_revision_records VALUES($1,$2)',[revision.id,JSON.stringify(revision)]);await db.pool.query("INSERT INTO content_outbox VALUES($1,'PRIVATE_PREVIEW_CHANGED')",[id(193)]);await db.pool.query('UPDATE content_workspace SET value=$1',[JSON.stringify(state)]);
  await db.pool.query("INSERT INTO avatar_visuals(id,layer,match_kind,model_id,variant_id,season,ski_length_cm,media_id,derivative_sha256,revision_id,release_id,state) VALUES($1,'SKI','EXACT_PROMISE',$2,$3,'2035/36',150,$4,$5,$6,$7,'ACTIVE')",[exact.id,exact.modelId,exact.variantId,exact.mediaId,exact.derivativeSha256,exact.revisionId,exact.releaseId]);
  assert.deepEqual((await reader.read([id(71)],new Date())).map(v=>v.id),[exact.id]);assert.deepEqual(await reader.read([],new Date()),[]);assert.deepEqual(await reader.read([id(999)],new Date()),[]);assert.ok(await reader.readBytes(exact.id,exact.derivativeSha256));
  await assert.rejects(db.pool.query("INSERT INTO avatar_visuals(id,layer,match_kind,model_id,variant_id,season,ski_length_cm,media_id,derivative_sha256,revision_id,release_id) VALUES($1,'SKI','EXACT_PROMISE',$2,$3,'2034/35',150,$4,$5,$6,$7)",[id(108),exact.modelId,exact.variantId,exact.mediaId,exact.derivativeSha256,exact.revisionId,exact.releaseId]),{code:'23514'});
  await db.pool.query('UPDATE content_workspace SET value=$1',[JSON.stringify(seed.state)]);
 });
 await check('current-rights check cannot be bypassed using an old caller timestamp',async()=>{const state=structuredClone(seed.state);state.catalog.media[0]!.rightsUntil='2000-01-01T00:00:00Z';await db.pool.query('UPDATE content_workspace SET value=$1',[JSON.stringify(state)]);assert.equal(await reader.findForDelivery(v.id,v.derivativeSha256,new Date('1999-01-01')),null);assert.equal(await reader.readBytes(v.id,v.derivativeSha256),null);});
}catch(e){failed=true;console.error('PHASE5_UPGRADE_FAILED '+stage+' '+String((e as {code?:string}).code??(e as Error).name));if(e instanceof assert.AssertionError)console.error(JSON.stringify({actual:e.actual,expected:e.expected}));console.error((e as Error).stack?.split('\n').filter(s=>s.includes('/tests/avatar/')).join('\n'));}
finally{await role?.close();await db.stop();console.log('Owned upgrade PostgreSQL closed.');}
if(failed)process.exit(1);
await mkdir('docs/execution/avatar-phase5',{recursive:true});await writeFile('docs/execution/avatar-phase5/upgrade.json',JSON.stringify({status:'PASS',results,checks:results.length,localOnly:true,cleanup:'Owned pools/PostgreSQL closed'},null,2)+'\n');
