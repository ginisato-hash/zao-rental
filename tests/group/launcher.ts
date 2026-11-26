import {randomBytes,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {migrate,seed} from '../../packages/db/src/index';
import {startIsolatedPostgres} from '../../scripts/postgres';
import {waitForPortFree} from '../../scripts/worktree';
import {provisionApplicationRoles} from '../../scripts/application-roles';
import {provisionGuestRole} from '../../scripts/guest-roles';
import {provisionContentRole} from '../../scripts/content-roles';
import {provisionGroupRole} from '../../scripts/group-role';
import {bootstrapDevelopmentAdmin} from '../../scripts/bootstrap-staff';
import {writeAccount} from '../../packages/auth/src/accounts';
import {loadStaff} from '../../packages/auth/src/staff-auth';
import {QuoteService} from '../../packages/core/src/pricing/quote-service';
import {GroupOrderService,type StaffActor} from '../../packages/core/src/group/group-service';
import {seedRecommendation,fid,variants} from '../recommendation/fixture';
import type {DevelopmentRuntime} from '../../packages/auth/src/config';

/** Isolated PostgreSQL + the real `tests/group-app` (next dev) for the customer group application. Synthetic data only.
 * The web child receives application roles (never the migration/owner connection) and the dedicated `<db>_group` role. */
export async function startGroupApp(options:{stock?:number;peerLimit?:number}={}){
 const stock=options.stock??150,db=await startIsolatedPostgres();
 let roles:Awaited<ReturnType<typeof provisionApplicationRoles>>|undefined,guest:Awaited<ReturnType<typeof provisionGuestRole>>|undefined,content:Awaited<ReturnType<typeof provisionContentRole>>|undefined,group:Awaited<ReturnType<typeof provisionGroupRole>>|undefined;
 let web:ReturnType<typeof spawn>|undefined;
 try{
  await migrate(db.pool);await seed(db.pool,db.identity.namespace);await waitForPortFree(db.identity.webPort);
  await db.pool.query(`CREATE OR REPLACE FUNCTION inventory_clock() RETURNS timestamptz LANGUAGE sql VOLATILE AS $$SELECT '2035-01-01T01:00:00Z'::timestamptz$$`);
  await seedRecommendation(db.pool,false,true);
  // Stock for 100-person groups: ski/boot assets and poles (public cap floor(150*0.95)=142).
  const c=await db.pool.connect();
  try{await c.query('BEGIN');await c.query("SELECT set_config('zao.actor','synthetic-group-ui-seed',true),set_config('zao.reason','SYNTHETIC group ui stock',true)");
   for(const [family,variant,base] of [['SKI',variants.ski,20000],['SKI_BOOT',variants.boot,21000],['SNOWBOARD',variants.board,22000],['SNOWBOARD_BOOT',variants.boardBoot,23000]] as const)for(let n=0;n<stock-1;n++)await c.query(`INSERT INTO ledger_assets(id,variant_id,family,initial_store_id,store_id,status,bsl_status,bsl_evidence,notes,source_kind,source_document,source_locator) VALUES($1,$2,$3,'MOUNTAIN_BASE','MOUNTAIN_BASE','AVAILABLE',$4,'','','SYNTHETIC','tests/group/launcher.ts',$5)`,[fid(base+n),variant,family,family.endsWith('BOOT')&&family==='SKI_BOOT'?'UNVERIFIED':'NOT_APPLICABLE','GRP-'+family+'-'+n]);
   // Extra length variants (public booking keeps a 95% ceiling, so a handful of units each) so shorter/longer and the SIZE-EDGE extremes are bookable.
   for(const [v,n] of [[7101,4],[7102,4],[7103,4],[7104,4],[7105,4],[1102,4]] as const)for(let k=0;k<n;k++)await c.query(`INSERT INTO ledger_assets(id,variant_id,family,initial_store_id,store_id,status,bsl_status,bsl_evidence,notes,source_kind,source_document,source_locator) VALUES(gen_random_uuid(),$1,'SKI','MOUNTAIN_BASE','MOUNTAIN_BASE','AVAILABLE','NOT_APPLICABLE','','SYNTHETIC extra length','SYNTHETIC','tests/group/launcher.ts',$2)`,[fid(v),'GRP-LEN-'+v+'-'+k]);
   await c.query('UPDATE ledger_poles SET quantity=$1,version=version+1 WHERE id=$2',[stock,fid(1301)]);await c.query('COMMIT');}
  catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  roles=await provisionApplicationRoles(db.pool,db.identity);guest=await provisionGuestRole(db.pool,db.identity);content=await provisionContentRole(db.pool,db.identity);group=await provisionGroupRole(db.pool,db.identity);
  const password=randomBytes(24).toString('base64url'),root=await bootstrapDevelopmentAdmin(db.pool,{email:'group-root@example.invalid',displayName:'SYNTHETIC Admin',password}),bp=(await loadStaff(db.pool,root))!;
  const perms={BOOKING_VIEW:true,BOOKING_CREATE:true,HOLD_VIEW:true,HOLD_EDIT:true,QUOTE_VIEW:true,QUOTE_CREATE:true,PRICE_EDIT:true,INVENTORY_VIEW:true} as const;
  const actor=(await writeAccount(roles.authPool,bp,undefined,{email:'group-actor@example.invalid',password,displayName:'SYNTHETIC Creator',active:true,role:'ADMIN',scope:'ALL',storeIds:[],permissions:perms})).id!,principal=(await loadStaff(db.pool,actor))!;
  await new QuoteService(roles.pricingPool,principal).initializePrivate(randomUUID(),'2035-01-01','2035-12-31');
  const admin:StaffActor={kind:'STAFF',subject:principal.subject,revision:principal.revision},svc=new GroupOrderService(group.groupPool);
  const entranceToken=(await svc.rotateEntrance(admin,'SYNTHETIC test entrance')).token;
  const origin=`http://127.0.0.1:${db.identity.webPort}`;
  const config:DevelopmentRuntime={origin,namespace:db.identity.namespace,authSecret:randomBytes(32).toString('hex'),authDb:roles.authDb,ledgerDb:roles.ledgerDb,holdDb:roles.holdDb,transferDb:roles.transferDb,pricingDb:roles.pricingDb,recommendationDb:roles.recommendationDb};
  const env:NodeJS.ProcessEnv={NODE_ENV:'development',PATH:process.env.PATH,NEXT_TELEMETRY_DISABLED:'1',ZAO_DEVELOPMENT_RUNTIME:JSON.stringify(config),ZAO_GUEST_RUNTIME:JSON.stringify(guest.guestDb),ZAO_CONTENT_READ_RUNTIME:JSON.stringify(content.contentReadDb),ZAO_CONTENT_RUNTIME:JSON.stringify(content.contentDb),ZAO_GROUP_RUNTIME:JSON.stringify(group.groupDb),ZAO_PUBLIC_ORIGIN:origin,...(options.peerLimit?{ZAO_TEST_GROUP_PEER_LIMIT:String(options.peerLimit)}:{})};
  let exited=false;
  web=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','tests/group-app','--webpack','--hostname','127.0.0.1','--port',String(db.identity.webPort)],{env,stdio:['ignore','pipe','pipe'],detached:true});
  const logs:string[]=[];web.stdout!.on('data',()=>{});web.stderr!.on('data',d=>{logs.push(String(d).slice(0,300));if(logs.length>40)logs.shift();});
  const exit=new Promise<void>(r=>{web!.once('exit',()=>{exited=true;r();});});
  const signal=(s:NodeJS.Signals)=>{try{process.kill(-web!.pid!,s);}catch{web!.kill(s);}};
  for(let i=0;i<600;i++){try{if((await fetch(origin+'/api/health')).ok)break;}catch{}if(exited)throw new Error('GROUP_APP_EXITED');if(i===599)throw new Error('GROUP_APP_START_TIMEOUT');await new Promise(r=>setTimeout(r,100));}
  const stop=async()=>{try{if(!exited){signal('SIGTERM');const timer=setTimeout(()=>signal('SIGKILL'),10000);try{await exit;}finally{clearTimeout(timer);}}}finally{await group!.close();await content!.close();await guest!.close();await roles!.close();await db.stop();}};
  return {origin,db,svc,admin,entranceToken,groupPool:group.groupPool,logs,stop,entranceUrl:(locale:'ja'|'en')=>`${origin}/${locale}/group/${entranceToken}`};
 }catch(e){try{if(web?.pid)process.kill(-web.pid,'SIGKILL');}catch{}await group?.close();await content?.close();await guest?.close();await roles?.close();await db.stop();throw e;}
}
