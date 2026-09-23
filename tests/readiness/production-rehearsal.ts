import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFileSync,existsSync} from 'node:fs';
import {flowFixture,simulation} from '../flow/fixture';
import {provisionGuestRole} from '../../scripts/guest-roles';
import {provisionBookingAccessRole} from '../../scripts/booking-access-role';
import {GuestContexts} from '../../packages/core/src/guest/context';
import {deriveBookingAccessKeys} from '../../packages/core/src/guest/booking-access-keys';
import {BookingRecovery} from '../../packages/core/src/guest/booking-recovery';
import {HoldService} from '../../packages/core/src/inventory/hold-service';
import {QuoteService} from '../../packages/core/src/pricing/quote-service';
import {BookingService} from '../../packages/core/src/payment/booking-service';
import {skiSet,variants} from '../inventory/fixture';
import {guestConfigurationHash,productionGuestConfiguration} from '../../packages/contracts/src/production-guest';
import {backupOwnedCluster,restoreOwnedCluster} from '../../scripts/isolated-backup';
import {assertPortFree} from '../../scripts/worktree';
import {migrate} from '../../packages/db/src/index';
const env:NodeJS.ProcessEnv={NODE_ENV:'production',PATH:process.env.PATH,NEXT_TELEMETRY_DISABLED:'1'};
function child(args:string[]){const p=spawn(process.execPath,args,{env,stdio:['ignore','pipe','pipe','ipc']});p.stdout!.resume();p.stderr!.resume();let code:number|null=null,forced=false;const exit=new Promise<number>(resolve=>{p.once('error',()=>{code=1;resolve(1);});p.once('exit',c=>{code=c??1;resolve(code);});});return {p,exit,get forced(){return forced;},async stop(){if(code!==null)return code;p.kill('SIGTERM');const timer=setTimeout(()=>{forced=true;p.kill('SIGKILL');},10000);try{return await exit;}finally{clearTimeout(timer);}}};}
async function worker(config:unknown){const c=child(['--import','tsx','tests/readiness/rehearsal-server.ts']);try{const ready=new Promise<Record<string,unknown>>((resolve,reject)=>{c.p.once('message',m=>resolve(m as Record<string,unknown>));c.p.once('exit',()=>reject(new Error('REHEARSAL_START_EXIT')));});c.p.send(config as object);let timer:ReturnType<typeof setTimeout>|undefined;try{const message=await Promise.race([ready,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('REHEARSAL_START_TIMEOUT')),10000);})]);return {...c,message};}finally{clearTimeout(timer);}}catch(e){await c.stop();throw e;}}
async function ready(origin:string){for(let i=0;i<100;i++){try{if((await fetch(origin+'/api/health')).ok)return;}catch{}await new Promise(r=>setTimeout(r,100));}throw new Error('NORMAL_PRODUCTION_START_TIMEOUT');}
let x:Awaited<ReturnType<typeof flowFixture>>|undefined,g:Awaited<ReturnType<typeof provisionGuestRole>>|undefined,a:Awaited<ReturnType<typeof provisionBookingAccessRole>>|undefined,w:Awaited<ReturnType<typeof worker>>|undefined,normal:ReturnType<typeof child>|undefined,restored:Awaited<ReturnType<typeof restoreOwnedCluster>>|undefined,sourceStopped=false,parentPoolsClosed=false,failed=false,stage='setup';
try{
 x=await flowFixture();
 // This guest-backed rehearsal needs one public SKI slot, hence two physical units.
 const seed=await x.db.pool.connect();try{await seed.query('BEGIN');await seed.query("SELECT set_config('zao.actor','synthetic-rehearsal',true),set_config('zao.reason','SYNTHETIC public rehearsal fixture',true)");
  await seed.query(`INSERT INTO ledger_assets(id,variant_id,family,initial_store_id,store_id,status,bsl_status,bsl_evidence,notes,source_kind,source_document,source_locator)
   VALUES($1,$2,'SKI','MOUNTAIN_BASE','MOUNTAIN_BASE','AVAILABLE','NOT_APPLICABLE','','SYNTHETIC rehearsal','SYNTHETIC','tests/readiness/production-rehearsal.ts','public-rehearsal-ski')`,[randomUUID(),variants.ski]);await seed.query('COMMIT');
 }catch(e){await seed.query('ROLLBACK');throw e;}finally{seed.release();}
 g=await provisionGuestRole(x.db.pool,x.db.identity);a=await provisionBookingAccessRole(x.db.pool,x.db.identity);const key=randomBytes(32),contexts=new GuestContexts(g.guestPool),guest=await contexts.create(),actor=await contexts.resolve(guest.token),hservice=new HoldService(x.roles.holdPool,actor),qservice=new QuoteService(x.roles.pricingPool,actor),bservice=new BookingService(x.flow.flowPool,g.guestPool,actor,x.fake,simulation),conditions=skiSet('2035-02-05'),hold=await hservice.command('create',randomUUID(),conditions),quote=(await qservice.create(randomUUID(),{conditions,holdId:hold.holdId,couponCode:null,wantAdvance:false})).quote,booking=await bservice.create(randomUUID(),quote.id,{displayName:'SYNTHETIC Rehearsal',email:'synthetic-rehearsal@example.invalid',termsAccepted:true});await bservice.startPayment(booking.id,randomUUID());let code='';
 await new BookingRecovery(a.accessPool,deriveBookingAccessKeys(key).recoveryKey,'rehearsal-recovery-v1',{async deliver(m){code=m.code;return {messageId:m.messageId,state:'DELIVERED'};},async lookup(messageId){return {messageId,state:'UNKNOWN'};}}).prepare(actor,booking.id,randomUUID());
 const approved=JSON.parse(readFileSync('config/production/guest.p4-approved-policy.json','utf8'));
 const configuration=productionGuestConfiguration({schemaVersion:1,revision:'SYNTHETIC-P5-REHEARSAL',ingressAdapterId:'synthetic-production-dispatcher',policy:{...approved.policy,version:'synthetic-p5-balanced'}}),config={kind:'SYNTHETIC_LOCAL_REHEARSAL',guestDb:g.guestDb,accessDb:a.accessDb,key:key.toString('base64url'),configuration,configurationSha256:guestConfigurationHash(configuration),externalTransport:'DISABLED',productionActivation:false,chargeReady:false};
 stage='invalid config startup';w=await worker({});assert.equal(w.message.state,'STARTUP_REJECTED');assert.equal(await w.exit,1);w=undefined;
 w=await worker({...config,configurationSha256:'0'.repeat(64)});assert.equal(w.message.state,'STARTUP_REJECTED');assert.equal(await w.exit,1);w=undefined;
 console.log('PASS production NODE_ENV worker rejects missing/unapproved config before listening; no external transport');
 stage='configured restricted worker';w=await worker(config);assert.equal(w.message.state,'READY');const origin='http://127.0.0.1:'+w.message.port,logical='https://rehearsal.invalid';
 const r=await fetch(origin+'/ready');assert.equal(r.status,200);assert.deepEqual(await r.json(),{localRehearsalReady:true,productionReady:false,externalTransport:'DISABLED',chargeReady:false});
 const requestId=randomUUID(),exchange=()=>fetch(origin+'/api/booking-access/recovery/exchange',{method:'POST',headers:{origin:logical,'content-type':'application/json'},body:JSON.stringify({code,requestId})});
 const first=await exchange();assert.equal(first.status,200);assert.deepEqual(first.headers.getSetCookie().map(c=>c.split('=')[0]),['zao_booking_access','zao_booking_cancel']);const cookie=first.headers.get('set-cookie')!.split(';')[0]!;assert.match(first.headers.get('set-cookie')!,/Secure/);await first.arrayBuffer(); // Deliberately discard the response; replay later.
 const before=(await x.db.pool.query('SELECT b.conditions,b.price_snapshot,b.price_sha256,h.expires_at,h.due_at FROM rental_bookings b JOIN inventory_holds h ON h.id=b.hold_id WHERE b.id=$1',[booking.id])).rows[0];
 const firstPid=w.p.pid;assert.equal(await w.stop(),0);w=undefined;await assertPortFree(x.db.identity.webPort+2);w=await worker(config);assert.notEqual(w.p.pid,firstPid);
 const replay=await exchange();assert.equal(replay.status,200);assert.equal(replay.headers.get('set-cookie')!.split(';')[0],cookie);assert.equal((await replay.json()).replayed,true);
 assert.equal((await fetch(origin+'/api/booking-access',{headers:{cookie}})).status,200);assert.equal((await fetch(origin+'/api/payments',{method:'POST'})).status,503);
 console.log('PASS real production-mode worker restart: original exchange response loss replays one read cookie; health/readiness and external/payment fail closed');
 stage='cold backup restore startup';assert.equal(await w.stop(),0);w=undefined;await g.close();await a.close();await x.roles.close();await x.flow.close();parentPoolsClosed=true;
 const backup=await backupOwnedCluster(x.db,()=>{sourceStopped=true;});restored=await restoreOwnedCluster(backup);await migrate(restored.pool);w=await worker(config);assert.equal(w.message.state,'READY');assert.equal((await fetch(origin+'/api/booking-access',{headers:{cookie}})).status,200);const after=(await restored.pool.query('SELECT b.conditions,b.price_snapshot,b.price_sha256,h.expires_at,h.due_at FROM rental_bookings b JOIN inventory_holds h ON h.id=b.hold_id WHERE b.id=$1',[booking.id])).rows[0];assert.deepEqual(after,before);assert.equal((await restored.pool.query('SELECT count(*)::int n FROM booking_access.capabilities')).rows[0].n,1);assert.equal(await w.stop(),0);w=undefined;await restored.stop();restored=undefined;
 console.log('PASS cold same-major verified backup -> new cluster -> production-mode restricted startup retains immutable booking/read capability; not provider PITR');
 stage='actual built Next production';assert.ok(existsSync('apps/web/.next/BUILD_ID'),'run build before rehearsal');await assertPortFree(x.db.identity.webPort);const normalOrigin='http://127.0.0.1:'+x.db.identity.webPort;normal=child(['node_modules/next/dist/bin/next','start','apps/web','--hostname','127.0.0.1','--port',String(x.db.identity.webPort)]);await ready(normalOrigin);
 for(const path of ['/api/booking-access','/api/guest/context']){const response=await fetch(normalOrigin+path,{...(path.endsWith('context')?{method:'POST',headers:{origin:normalOrigin,'content-type':'application/json'},body:'{}'}:{})});assert.equal(response.status,503);}
 assert.equal((await fetch(normalOrigin+'/api/health')).status,200);const nextExit=await normal.stop();assert.ok(nextExit===0||nextExit===143);assert.equal(normal.forced,false);console.log('Built Next requested SIGTERM exit='+nextExit+' forced=false');normal=undefined;await assertPortFree(x.db.identity.webPort);
 console.log('P5 production rehearsal:4 groups passed; built Next fails closed; separate injected production handler worker + real PG/restart/restore; external requests0.');
}catch(e){failed=true;console.error('P5_REHEARSAL_FAILED '+stage+' '+String((e as {code?:string}).code??(e as Error).name));console.error((e as Error).stack?.split('\n').filter(s=>s.includes('/tests/readiness/')).join('\n'));}finally{await normal?.stop();await w?.stop();await restored?.stop();if(!parentPoolsClosed){await g?.close();await a?.close();}if(x&&!sourceStopped){if(parentPoolsClosed)await x.db.stop();else await x.close();}console.log('Owned P5 production rehearsal processes stopped.');}if(failed)process.exit(1);
