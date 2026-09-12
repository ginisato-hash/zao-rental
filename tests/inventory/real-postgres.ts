import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import os from 'node:os';
import {migrate,migrationPlan,migrationsDirectory} from '@rental/db';
import {startIsolatedPostgres} from '../../scripts/postgres';
import {provisionApplicationRoles} from '../../scripts/application-roles';
import {bootstrapDevelopmentAdmin} from '../../scripts/bootstrap-staff';
import {createStaffAuth,loadStaff} from '../../packages/auth/src/staff-auth';
import {writeAccount} from '../../packages/auth/src/accounts';
import {HoldService} from '../../packages/core/src/inventory/hold-service';
import {HoldError,paymentDecision} from '../../packages/contracts/src/hold';
import {LedgerService} from '../../packages/core/src/catalog/ledger-service';
import {ledgerHandler} from '../../apps/web/src/lib/ledger-http';
import {authHandler} from '../../apps/web/src/lib/auth-http';
import {resolveStaff,ledgerPrincipal} from '../../packages/auth/src/staff-auth';
import {seedInventory,requestFor,skiSet,variants,fid} from './fixture';
let count=0,stage='startup';let failed=false;const db=await startIsolatedPostgres();let roles:Awaited<ReturnType<typeof provisionApplicationRoles>>|undefined;
async function check(name:string,f:()=>Promise<void>){stage=name;await f();count++;console.log('PASS '+name);}
const origin='http://127.0.0.1:34567';let now=new Date('2029-01-01T00:00:00Z');
try{
 // Populate exact PR #5 migrations, credentials and ledger BEFORE applying 0004.
 for(const m of migrationPlan.slice(0,3)){const sql=await readFile(migrationsDirectory+'/'+m.file,'utf8');await db.pool.query(sql);await db.pool.query('CREATE TABLE IF NOT EXISTS foundation_migrations(id text PRIMARY KEY,checksum text NOT NULL)');await db.pool.query('INSERT INTO foundation_migrations VALUES($1,$2)',[m.id,createHash('sha256').update(sql).digest('hex')]);}
 await seedInventory(db.pool);const secret=randomBytes(32).toString('hex'),password=randomBytes(24).toString('base64url');
 const adminId=await bootstrapDevelopmentAdmin(db.pool,{email:'upgrade-admin@example.invalid',displayName:'合成アップグレード管理者',password});
 const auth=createStaffAuth(db.pool,{origin,secret});const authHttp=authHandler(auth,db.pool,origin,db.pool);
 const signIn=await authHttp(new Request(origin+'/api/auth/sign-in/email',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({email:'upgrade-admin@example.invalid',password})}));assert.equal(signIn.status,200);
 const cookie=signIn.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');const authHeaders=new Headers({cookie,origin});
 const ledgerHttp=ledgerHandler(async()=>{const s=await resolveStaff(auth,db.pool,authHeaders);return s.status==='authorized'?ledgerPrincipal(s.principal):null;},p=>new LedgerService(db.pool,p,async()=>{/* Explicit synthetic fixture boundary; normal runtime uses verifyLedgerWrite. */},async()=>{/* Explicit fixture-only lifecycle boundary; normal runtime uses reconcileLedgerProtection. */}),origin);
 await check('populated PR5 upgrade preserves original migration hashes, real password session and normal protected ledger API',async()=>{
  const before=await ledgerHttp(new Request(origin+'/api/ledger/assets',{headers:authHeaders}));assert.equal(before.status,200);const n=(await before.json()).total;
  await Promise.all([migrate(db.pool),migrate(db.pool)]);assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM foundation_migrations')).rows[0].n,migrationPlan.length);
  assert.equal((await resolveStaff(auth,db.pool,authHeaders)).status,'authorized');const after=await ledgerHttp(new Request(origin+'/api/ledger/assets',{headers:authHeaders}));assert.equal(after.status,200);assert.equal((await after.json()).total,n);
  const update=await ledgerHttp(new Request(origin+'/api/ledger/assets/'+fid(1201),{method:'PATCH',headers:{cookie,origin,'content-type':'application/json'},body:JSON.stringify({version:1,reason:'Synthetic upgrade check',notes:'Persisted after PR5 upgrade'})}));assert.equal(update.status,200);
  assert.equal((await (await ledgerHttp(new Request(origin+'/api/ledger/assets/'+fid(1201),{headers:authHeaders}))).json()).notes,'Persisted after PR5 upgrade');
 });
 roles=await provisionApplicationRoles(db.pool,db.identity);const c1=await roles.holdPool.connect(),c2=await roles.holdPool.connect();try{assert.notEqual((await c1.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,(await c2.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);}finally{c1.release();c2.release();}const principal=(await loadStaff(db.pool,adminId))!;
 const settings={displayName:'合成HOLD担当',active:true,role:'STAFF' as const,scope:'ASSIGNED' as const,storeIds:['MOUNTAIN_BASE' as const,'ONSEN_BASE' as const],permissions:{HOLD_VIEW:true,HOLD_EDIT:true}};
 const actor=(await writeAccount(roles.authPool,principal,undefined,{...settings,email:'synthetic-hold@example.invalid',password})).id!;
 const other=(await writeAccount(roles.authPool,principal,undefined,{...settings,email:'synthetic-other@example.invalid',password})).id!;
 const service=async(subject=actor)=>new HoldService(roles!.holdPool,(await loadStaff(roles!.authPool,subject))!,()=>now);
 async function reset(){now=new Date(now.getTime()+601000);}
 async function create(c=requestFor('2030-01-01')){return (await service()).command('create',randomUUID(),c);}
 async function held(id:string){return (await db.pool.query('SELECT requirement_key,asset_id,pole_id,pole_slot,day::text FROM inventory_claims WHERE hold_id=$1 AND active ORDER BY requirement_key,day',[id])).rows;}
 async function stageAllocation(id:string,stage:string){const c=await db.pool.connect();try{await c.query('BEGIN');await c.query("SELECT set_config('zao.actor',$1,true)",[actor]);await c.query('UPDATE inventory_holds SET allocation_stage=$2 WHERE id=$1',[id,stage]);await c.query('COMMIT');}finally{c.release();}}
 await check('remaining one, six concurrent requests across pooled connections: exactly one whole HOLD succeeds',async()=>{
  const responses=await Promise.all(Array.from({length:6},()=>create()));assert.equal(responses.filter(r=>r.result==='CREATED').length,1);assert.equal(responses.filter(r=>r.result==='INSUFFICIENT').length,5);assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM inventory_claims WHERE active')).rows[0].n,1);
 });await reset();
 await check('missing one group member or set component leaves zero partial claims',async()=>{
  const c=skiSet('2030-01-02');c.members.push({...structuredClone(c.members[0]!),key:'person-b'});const before=(await db.pool.query('SELECT count(*)::int AS n FROM inventory_holds')).rows[0].n;assert.equal((await create(c)).result,'INSUFFICIENT');assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM inventory_holds')).rows[0].n,before);
  const one=skiSet('2030-01-02');const bootBlock=randomUUID();await db.pool.query("INSERT INTO inventory_constraints VALUES($1,$2,NULL,'2030-01-02','2030-01-02','MAINTENANCE','synthetic-boot-maintenance')",[bootBlock,fid(1203)]);assert.equal((await create(one)).result,'INSUFFICIENT');assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM inventory_holds')).rows[0].n,before);
 });await reset();
 await check('AM whole-day asset and pole claims reject same-day PM',async()=>{
  const c=skiSet('2030-01-03');c.period.slot='AM';assert.equal((await create(c)).result,'CREATED');const pm=skiSet('2030-01-03');pm.period.slot='PM';assert.equal((await create(pm)).result,'INSUFFICIENT');
  const poles=requestFor('2030-01-03');poles.period.slot='PM';poles.members[0]!.items=[{family:'POLE',variantIds:[variants.pole]}];assert.equal((await create(poles)).result,'INSUFFICIENT');
 });await reset();
 await check('daily one free but no continuous asset cannot satisfy a two-day request',async()=>{
  await db.pool.query("INSERT INTO inventory_constraints VALUES($1,$2,NULL,'2030-01-04','2030-01-04','OUT','synthetic-rented-day1'),($3,$4,NULL,'2030-01-05','2030-01-05','MAINTENANCE','synthetic-maintenance-day2')",[randomUUID(),fid(1201),randomUUID(),fid(1202)]);
  const c=requestFor('2030-01-04',[variants.ski,variants.skiAlt]);c.period.endDate='2030-01-05';c.period.slot='MULTIDAY';assert.equal((await create(c)).result,'INSUFFICIENT');
 });await reset();
 await check('flexible A150/155 and constrained B150 find A155+B150 atomically',async()=>{
  const c=requestFor('2030-01-06',[variants.ski,variants.skiAlt]);c.members.push({...structuredClone(c.members[0]!),key:'person-b',items:[{family:'SKI',variantIds:[variants.ski]}]});const r=await create(c);assert.equal(r.result,'CREATED');const rows=await held(r.holdId!);assert.equal(rows.find(x=>x.requirement_key.startsWith('person-a')).asset_id,fid(1202));assert.equal(rows.find(x=>x.requirement_key.startsWith('person-b')).asset_id,fid(1201));
 });await reset();
 await check('provisional other-owner HOLD can be safely rearranged without changing its promise or expiry',async()=>{
  const a=await (await service(other)).command('create',randomUUID(),requestFor('2030-01-07',[variants.ski,variants.skiAlt]));assert.equal((await held(a.holdId!))[0].asset_id,fid(1201));
  const before=await (await service(other)).get(a.holdId!);const b=await create(requestFor('2030-01-07'));assert.equal(b.result,'CREATED');assert.equal((await held(a.holdId!))[0].asset_id,fid(1202));const after=await (await service(other)).get(a.holdId!);assert.deepEqual(after.conditions,before.conditions);assert.equal(after.expiresAt,before.expiresAt);assert.ok((await db.pool.query('SELECT count(*)::int AS n FROM inventory_replans')).rows[0].n>0);
 });await reset();
 await check('prepared/lent fixed allocations cannot move; failed replacement retains complete old hold',async()=>{
  const a=await create(requestFor('2030-01-08',[variants.ski,variants.skiAlt]));await stageAllocation(a.holdId!,'PREPARATION_FIXED');const before=await held(a.holdId!);assert.equal((await create(requestFor('2030-01-08'))).result,'INSUFFICIENT');assert.deepEqual(await held(a.holdId!),before);
  await assert.rejects((await service()).command('cancel',randomUUID(),undefined,a.holdId),{code:'ALLOCATION_FIXED'});
  await stageAllocation(a.holdId!,'RENTAL_FIXED');assert.equal((await create(requestFor('2030-01-08'))).result,'INSUFFICIENT');await stageAllocation(a.holdId!,'PROVISIONAL');
 });await reset();
 await check('safe explicit asset replacement succeeds; replacement breaking another reservation fails without losing old hold or TTL',async()=>{
  const c=requestFor('2030-01-09'),a=await create(c),before=a.hold!.expiresAt;
  const replacement={...c,members:[{...c.members[0]!,items:[{family:'SKI' as const,variantIds:[variants.skiAlt]}]}]};assert.equal((await (await service()).availability(replacement,a.holdId)).result,'FEASIBLE');
  const moved=await (await service()).command('amend',randomUUID(),replacement,a.holdId);assert.equal(moved.result,'AMENDED');assert.equal(moved.hold!.expiresAt,before);assert.equal((await held(a.holdId!))[0].asset_id,fid(1202));
  assert.equal((await create(requestFor('2030-01-09'))).result,'CREATED');const failed=await (await service()).command('amend',randomUUID(),c,a.holdId);assert.equal(failed.result,'INSUFFICIENT');assert.equal((await held(a.holdId!))[0].asset_id,fid(1202));assert.equal(failed.hold!.expiresAt,before);
 });await reset();
 await check('explicit provisional asset reassignment preserves exact conditions and rejects non-candidate model/size',async()=>{
  const c=requestFor('2030-01-15',[variants.ski,variants.skiAlt]),r=await create(c),before=r.hold!.conditions;
  const moved=await (await service()).command('reassign',randomUUID(),{requirementKey:'person-a:SKI',assetId:fid(1202)},r.holdId);assert.equal(moved.result,'AMENDED');assert.deepEqual(moved.hold!.conditions,before);assert.equal((await held(r.holdId!))[0].asset_id,fid(1202));
  const failed=await (await service()).command('reassign',randomUUID(),{requirementKey:'person-a:SKI',assetId:fid(1203)},r.holdId);assert.equal(failed.result,'INSUFFICIENT');assert.deepEqual(await held(r.holdId!),await held(moved.holdId!));assert.equal((await held(r.holdId!))[0].asset_id,fid(1202));
 });await reset();
 await check('concurrent replacements never duplicate physical claims, future commitments do not consume unrelated periods',async()=>{
  const a=await create(requestFor('2030-02-01')),b=await create(requestFor('2030-02-01',[variants.skiAlt]));
  const outcomes=await Promise.all([a,b].map(r=>(async()=>{const c={...r.hold!.conditions,members:[{...r.hold!.conditions.members[0]!,items:[{family:'SKI' as const,variantIds:[variants.skiAlt]}]}]};return (await service()).command('amend',randomUUID(),c,r.holdId);})()));assert.equal(outcomes.filter(r=>r.result==='AMENDED').length,1);assert.equal((await held(a.holdId!))[0].asset_id,fid(1201));assert.equal((await create(requestFor('2030-01-20'))).result,'CREATED');
 });await reset();
 await check('idempotency, payload mismatch, cancellation/expiration races and retries conserve quantity',async()=>{
  const c=skiSet('2030-03-01'),key=randomUUID(),s=await service();const [a,b]=await Promise.all([s.command('create',key,c),s.command('create',key,c)]);assert.equal(a.holdId,b.holdId);await assert.rejects(s.command('create',key,{...c,returnStore:'ONSEN_BASE'}),{code:'IDEMPOTENCY_MISMATCH'});
  await Promise.all([s.command('cancel',randomUUID(),undefined,a.holdId),s.command('cancel',randomUUID(),undefined,a.holdId),create(skiSet('2030-03-01'))]);assert.equal((await held(a.holdId!)).length,0);
  await reset();const result=await create(skiSet('2030-03-01'));assert.equal(result.result,'CREATED');await reset();const [expired,replacement]=await Promise.all([s.command('expire',randomUUID(),undefined,result.holdId),create(skiSet('2030-03-01'))]);assert.equal(expired.result,'EXPIRED');assert.equal(replacement.result,'CREATED');assert.equal((await s.command('create',key,c)).hold!.state,'RELEASED');
 });await reset();
 await check('ten inclusive dates hold all three components and direct ledger edits cannot invalidate protected stock',async()=>{
  const c=skiSet('2030-12-28');c.period.slot='MULTIDAY';c.period.endDate='2031-01-06';const r=await create(c);assert.equal(r.result,'CREATED');const rows=await held(r.holdId!);assert.equal(rows.length,30);assert.equal(new Set(rows.filter(x=>x.asset_id).map(x=>x.asset_id)).size,2);assert.equal(new Set(rows.map(x=>x.day)).size,10);
  const ledger=new LedgerService(roles!.ledgerPool,{subject:actor,role:'ADMIN',storeIds:['MOUNTAIN_BASE']},async()=>{/* Explicit synthetic fixture boundary; normal runtime uses verifyLedgerWrite. */},async()=>{/* Explicit fixture-only lifecycle boundary; normal runtime uses reconcileLedgerProtection. */});const asset=await ledger.get('assets',fid(1201)),pole=await ledger.get('poles',fid(1301));await assert.rejects(ledger.update('assets',asset.id,{version:asset.version,reason:'Synthetic protected-stock test',status:'MAINTENANCE'}),{code:'CONSTRAINT_VIOLATION'});await assert.rejects(ledger.update('poles',pole.id,{version:pole.version,reason:'Synthetic protected-quantity test',quantity:0}),{code:'CONSTRAINT_VIOLATION'});assert.equal((await held(r.holdId!)).length,30);
 });await reset();
 await check('age/tier mismatch, unauthorized owner/store and lock waiting are denied without inventory mutation',async()=>{
  const c=requestFor('2030-03-02');for(const x of [variants.kids,variants.premium])await assert.rejects(create({...c,members:[{...c.members[0]!,items:[{family:'SKI',variantIds:[x]}]}]}),{code:'VARIANT_MISMATCH'});
  const a=await create(c);const lock=await db.pool.connect();try{await lock.query('BEGIN');await lock.query('SELECT pg_advisory_xact_lock(71820600)');
   await assert.rejects((await service(other)).command('cancel',randomUUID(),undefined,a.holdId),{code:'FORBIDDEN'});
   const waiting=await service();await assert.rejects(waiting.command('create',randomUUID(),requestFor('2030-03-03')),{code:'INDETERMINATE'});
  }finally{await lock.query('ROLLBACK');lock.release();}
  assert.equal((await create(requestFor('2030-03-03'))).result,'CREATED');
 });await reset();
 await check('cross-store return records future custody fence, unverified transfers never turn other-store stock into capacity',async()=>{
  const c=requestFor('2030-04-01');c.returnStore='ONSEN_BASE';const r=await create(c);assert.equal(r.result,'CREATED');const sourceResult=await create(requestFor('2030-04-02'));console.log('SOURCE_AFTER_RETURN '+sourceResult.result);assert.equal(sourceResult.result,'TRANSFER_PLAN_REQUIRED');
  const foreign=requestFor('2030-04-02');foreign.pickupStore='ONSEN_BASE';foreign.returnStore='ONSEN_BASE';const destinationResult=await create(foreign);console.log('DESTINATION_BEFORE_RECEIPT '+destinationResult.result);assert.equal(destinationResult.result,'TRANSFER_PLAN_REQUIRED');
  await db.pool.query("INSERT INTO inventory_constraints VALUES($1,$2,NULL,'2030-05-01','2030-05-01','TRANSFER_UNVERIFIED','synthetic-E07-input')",[randomUUID(),fid(1201)]);const transferResult=await create(requestFor('2030-05-01'));console.log('UNVERIFIED_TRANSFER '+transferResult.result);assert.equal(transferResult.result,'TRANSFER_PLAN_REQUIRED');assert.equal((await (await service()).get(r.holdId!)).conditions.returnStore,'ONSEN_BASE');
 });await reset();
 await check('unrelated cross-store return cannot misclassify missing or maintained components as transfer capacity',async()=>{
  const board=requestFor('2030-07-01',[variants.board]);board.members[0]!.items[0]!.family='SNOWBOARD';board.returnStore='ONSEN_BASE';assert.equal((await create(board)).result,'CREATED');
  const blocker=randomUUID();await db.pool.query("INSERT INTO inventory_constraints VALUES($1,$2,NULL,'2030-07-02','2030-07-02','MAINTENANCE','synthetic-unrelated-transfer')",[blocker,fid(1201)]);
  assert.equal((await create(requestFor('2030-07-02'))).result,'INSUFFICIENT');
  // Even a relevant other-store component cannot cure a different, genuinely missing component.
  const mixed=requestFor('2030-07-02');mixed.members.push({key:'board-b',product:'SINGLE',age:'ADULT',tier:'REGULAR',items:[{family:'SNOWBOARD',variantIds:[variants.board]}]});
  assert.equal((await create(mixed)).result,'INSUFFICIENT');
  await db.pool.query('DELETE FROM inventory_constraints WHERE id=$1',[blocker]);
 });await reset();
 await check('pending/unknown payment retains claims across TTL; late success cannot confirm a released inventory promise',async()=>{
  const r=await create(requestFor('2030-06-01'));const c=await db.pool.connect();try{await c.query('BEGIN');await c.query("SELECT set_config('zao.actor',$1,true)",[actor]);await c.query("UPDATE inventory_holds SET payment_state='UNKNOWN' WHERE id=$1",[r.holdId]);await c.query('COMMIT');}finally{c.release();}
  await reset();assert.equal((await create(requestFor('2030-06-01'))).result,'INSUFFICIENT');await assert.rejects((await service()).command('cancel',randomUUID(),undefined,r.holdId),{code:'PAYMENT_RECONCILIATION_REQUIRED'});
  assert.equal(paymentDecision('SUCCESS',false,true,false),'INVENTORY_REACQUIRE_REQUIRED');assert.equal((await db.pool.query("SELECT count(*)::int AS n FROM inventory_holds WHERE state='CONFIRMED'")).rows[0].n,0);
 });await reset();
 await check('application HOLD role cannot read credentials, edit staff/custody/audit, or create DDL',async()=>{for(const sql of ['SELECT * FROM auth_session','SELECT * FROM auth_account','UPDATE staff_members SET active=false','UPDATE ledger_assets SET status=\'AVAILABLE\'','DELETE FROM inventory_history','UPDATE inventory_replans SET actor=actor','INSERT INTO inventory_constraints SELECT * FROM inventory_constraints','CREATE TABLE escape_hold(id int)'])await assert.rejects(roles!.holdPool.query(sql),{code:'42501'});});
 await check('indexed owner/history reads batch 100 holds on one connection while another owner can write',async()=>{
  const c=await db.pool.connect();let first:string;
  try{await c.query('BEGIN');await c.query("SELECT set_config('zao.actor',$1,true)",[actor]);
   await c.query('INSERT INTO inventory_reservations SELECT gen_random_uuid(),$1 FROM generate_series(1,240)',[actor]);
   const inserted=await c.query(`INSERT INTO inventory_holds(id,reservation_id,owner_id,pickup_store,return_store,conditions,starts_at,due_at,occupancy_start,occupancy_end,expires_at,state)
    SELECT gen_random_uuid(),r.id,r.owner_id,'MOUNTAIN_BASE','MOUNTAIN_BASE',jsonb_set($2::jsonb,'{reservationId}',to_jsonb(r.id)), '2033-01-01 08:30+09','2033-01-01 17:00+09','2033-01-01','2033-01-01','2033-01-01','RELEASED'
    FROM inventory_reservations r WHERE r.owner_id=$1 AND NOT EXISTS(SELECT 1 FROM inventory_holds h WHERE h.reservation_id=r.id) RETURNING id`,[actor,requestFor('2033-01-01')]);
   first=inserted.rows[0].id;await c.query('UPDATE inventory_holds SET version=version+1 WHERE id=ANY($1::uuid[])',[inserted.rows.map(r=>r.id)]);await c.query('UPDATE inventory_holds SET version=version+1 WHERE id=ANY($1::uuid[])',[inserted.rows.map(r=>r.id)]);await c.query('COMMIT');
  }finally{c.release();}
  await db.pool.query('ANALYZE inventory_holds; ANALYZE inventory_history');
  const ownerPlan=(await db.pool.query("EXPLAIN (FORMAT JSON) SELECT * FROM inventory_holds WHERE owner_id=$1 AND pickup_store=ANY($2::text[]) AND return_store=ANY($2::text[]) ORDER BY created_at DESC,id LIMIT 100",[actor,['MOUNTAIN_BASE','ONSEN_BASE']])).rows[0];
  const historyPlan=(await db.pool.query('EXPLAIN (FORMAT JSON) SELECT event,actor,occurred_at FROM inventory_history WHERE hold_id=$1 ORDER BY id',[first])).rows[0];
  assert.match(JSON.stringify(ownerPlan),/inventory_holds_owner_idx/);assert.match(JSON.stringify(historyPlan),/inventory_history_hold_idx/);
  assert.ok((await db.pool.query('SELECT count(*)::int AS n FROM inventory_history')).rows[0].n>500);
  const s=await service();let acquired=0;const listener=()=>{acquired++;};roles!.holdPool.on('acquire',listener);
  try{const listed=await s.list();assert.equal(listed.length,100);assert.ok(listed.every(h=>h.history.length===3));assert.equal(acquired,1);}finally{roles!.holdPool.off('acquire',listener);}
  const blocked=await roles!.holdPool.connect(),blocked2=await roles!.holdPool.connect();
  try{const writer=await service(other);const [listed,written]=await Promise.all([s.list(),writer.command('create',randomUUID(),requestFor('2033-01-02'))]);assert.equal(listed.length,100);assert.equal(written.result,'CREATED');}finally{blocked.release();blocked2.release();}
 });await reset();
 await check('exhausted real four-connection HOLD pool returns bounded INDETERMINATE on reads and write preflight',async()=>{
  const s=await service(),clients=[];for(let i=0;i<4;i++)clients.push(await roles!.holdPool.connect());const started=performance.now();
  try{await Promise.all([s.list(),s.options(),s.command('create',randomUUID(),requestFor('2033-01-03'))].map(p=>assert.rejects(p,{code:'INDETERMINATE',status:503})));assert.ok(performance.now()-started<4000);}finally{clients.forEach(c=>c.release());}
  assert.equal((await s.command('create',randomUUID(),requestFor('2033-01-03'))).result,'CREATED');
 });await reset();
 await check('300 combined ski/board synthetic load, full ten-day groups, bounded concurrent latency probe',async()=>{
  await seedInventory(db.pool,true);const boards=(await db.pool.query("SELECT count(*)::int AS n FROM ledger_assets WHERE family IN ('SKI','SNOWBOARD')")).rows[0].n;assert.equal(boards,300);
  const latencies:number[]=[];const s=await service();const iterations=24,concurrency=4;
  for(let i=0;i<iterations;i+=concurrency)await Promise.all(Array.from({length:concurrency},async()=>{const c=skiSet('2031-01-01');c.period.slot='MULTIDAY';c.period.endDate='2031-01-10';const start=performance.now();assert.equal((await s.availability(c)).result,'FEASIBLE');latencies.push(performance.now()-start);}));
  const holdLatencies:number[]=[];
  for(let i=0;i<iterations;i+=concurrency)await Promise.all(Array.from({length:concurrency},async()=>{const c=skiSet('2034-01-01');c.period.slot='MULTIDAY';c.period.endDate='2034-01-10';const start=performance.now();assert.equal((await s.command('create',randomUUID(),c)).result,'CREATED');holdLatencies.push(performance.now()-start);}));
  holdLatencies.sort((a,b)=>a-b);
  const holdAcquisition={operation:'ten-day ski set HOLD with accumulated provisional replans',iterations,concurrency,p50_ms:holdLatencies[Math.ceil(iterations*.50)-1],p95_ms:holdLatencies[Math.ceil(iterations*.95)-1]};
  latencies.sort((a,b)=>a-b);const measurement={synthetic:true,combinedSkiBoardAssets:boards,componentsAdditional:true,node:process.version,platform:process.platform,arch:process.arch,cpu:os.cpus()[0]?.model,postgres:(await db.pool.query('SHOW server_version')).rows[0].server_version,concurrency,iterations,operation:'availability ten-day ski set with provisional replan',p50_ms:latencies[Math.ceil(iterations*.50)-1],p95_ms:latencies[Math.ceil(iterations*.95)-1],hold_acquisition:holdAcquisition,productionGuarantee:false};await mkdir('.local/benchmarks',{recursive:true});await writeFile('.local/benchmarks/e06.json',JSON.stringify(measurement,null,2)+'\n');console.log(JSON.stringify(measurement));
 });
 console.log(`E06 real PostgreSQL: ${count} passed; 0 skipped.`);
}catch(e){if((e as {code?:string}).code==='ERR_ASSERTION'){const a=e as {actual?:unknown;expected?:unknown};console.error(JSON.stringify({actual:typeof a.actual==='string'&&/^[A-Z_]{1,80}$/.test(a.actual)?a.actual:typeof a.actual==='number'?a.actual:'withheld',expected:typeof a.expected==='string'&&/^[A-Z_]{1,80}$/.test(a.expected)?a.expected:typeof a.expected==='number'?a.expected:'withheld'}));}console.error('E06_TEST_FAILED '+stage+' '+(e instanceof HoldError?e.code:(e as {code?:string}).code??(e as Error).name));failed=true;}finally{if(roles)await roles.close();await db.stop();console.log('Owned E06 PostgreSQL stopped.');}

if(failed)process.exit(1);
