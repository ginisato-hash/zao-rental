import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import type {Pool,PoolClient} from 'pg';
import {migrationPlan,migrationsDirectory} from '../packages/db/src/index';
import {phase6Database} from '../packages/auth/src/hosted-preview-config';
import {phase6NeonHostname,proveNeonClientTls} from '../packages/db/src/neon-tls';
export async function avatarMigrationSources(){
 const expected=JSON.parse(await readFile('docs/execution/avatar-artwork-activation/migration-hashes.json','utf8')) as {file:string;sha256:string}[];
 if(expected.length!==32||migrationPlan.length!==32)throw Error('PHASE6_MIGRATION_RANGE');
 const sources=[];
 for(let i=0;i<32;i++){const m=migrationPlan[i]!,sql=await readFile(migrationsDirectory+'/'+m.file,'utf8'),sha256=createHash('sha256').update(sql).digest('hex');
  if(!expected[i]!.file.endsWith('/'+m.file)||sha256!==expected[i]!.sha256)throw Error('PHASE6_MIGRATION_HASH');sources.push({...m,sha256,sql});}
 return sources;
}
type Sources=Awaited<ReturnType<typeof avatarMigrationSources>>;
export async function avatarMigrationPreflight(client:Pick<PoolClient,'query'>,sources:Sources,database:string,owner:string){
 const a=(await client.query('SELECT current_database() db,current_user role')).rows[0];if(a.db!==database||a.role!==owner)throw Error('PHASE6_MIGRATION_IDENTITY');
 const rows=(await client.query('SELECT id,checksum FROM public.foundation_migrations ORDER BY id')).rows;
 if(rows.length!==30||rows.some((r,i)=>r.id!==sources[i]!.id||r.checksum!==sources[i]!.sha256))throw Error('PHASE6_MIGRATION_HISTORY_RECONCILE');
 const state=(await client.query("SELECT to_regclass('public.avatar_visuals') visuals,to_regclass('public.avatar_current_visuals') projection,to_regprocedure('public.avatar_visual_derivative(uuid,text)') derivative")).rows[0];
 if(Object.values(state).some(x=>x!==null))throw Error('PHASE6_PARTIAL_MIGRATION_RECONCILE');
 return {database:a.db,owner:a.role,historyCount:30,sourceHashes:sources.map(({id,sha256})=>({id,sha256})),avatarAbsent:true};
}
/** Shared transaction for canonical local PG proof and the separately gated hosted dispatcher.
 * No CREATE DATABASE/resource; no historical migration reapplication; no retry. */
export async function applyAvatarMigrationTransaction(pool:Pool,sources:Sources,database:string,owner:string){
 const c=await pool.connect();let migrationId:string|null=null;
 try{
  await c.query('BEGIN');await c.query("SET LOCAL lock_timeout='1500ms';SET LOCAL statement_timeout='15000ms'");
  await c.query('SELECT pg_advisory_xact_lock(71820401)');
  await c.query('LOCK TABLE public.foundation_migrations IN EXCLUSIVE MODE');
  await avatarMigrationPreflight(c,sources,database,owner);
  for(const source of sources.slice(30)){migrationId=source.id;await c.query(source.sql);await c.query('INSERT INTO public.foundation_migrations(id,checksum) VALUES($1,$2)',[source.id,source.sha256]);}
  await c.query('COMMIT');return {status:'PASS',applied:['0031','0032'],historicalApplied:0};
 }catch(e){await c.query('ROLLBACK').catch(()=>{});throw Object.assign(Error('PHASE6_MIGRATION_FAILED'),{migrationId,sqlstate:/^[0-9A-Z]{5}$/.test((e as {code?:string}).code??'')?(e as {code:string}).code:null,category:'MIGRATION_TRANSACTION'});}finally{c.release();}
}
export async function migrateHostedAvatar(pool:Pool,reserve:()=>Promise<void>){
 if(process.env.NODE_ENV==='production'||pool.options.database!==phase6Database||pool.options.user!=='neondb_owner'||pool.options.host!==phase6NeonHostname||typeof pool.options.ssl!=='object'||pool.options.ssl.rejectUnauthorized!==true)throw Error('PHASE6_SETUP_CONNECTION_REQUIRED');
 const sources=await avatarMigrationSources(),client=await pool.connect();let preflight;
 try{proveNeonClientTls(client,pool.options);preflight=await avatarMigrationPreflight(client,sources,phase6Database,'neondb_owner');}finally{client.release();}
 // Caller must exclusively create+fsync a durable one-shot receipt before any mutation.
 await reserve();const result=await applyAvatarMigrationTransaction(pool,sources,phase6Database,'neondb_owner');return {...result,preflight};
}
