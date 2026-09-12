// Manual audit reproducer, deliberately not a CI acceptance gate: observations describe OPEN defects.
// No production change is made. Ordinary synthetic staff sessions + disposable development DB only.
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {chromium,expect,type BrowserContext} from '@playwright/test';
import {startDevelopmentApp} from '../../scripts/development-app';
import {bootstrapDevelopmentAdmin} from '../../scripts/bootstrap-staff';
import {seedRecommendation,fid} from './fixture';
import {skiSet} from '../inventory/fixture';
import {parseConditions,HoldError} from '../../packages/contracts/src/hold';
import {matchPeriods} from '../../packages/core/src/inventory/period-matching';
import {readJson} from '../../apps/web/src/lib/ledger-http';
import type {AccountSettings} from '../../packages/auth/src/accounts';
const browser=await chromium.launch(),password=randomBytes(24).toString('base64url');let app:Awaited<ReturnType<typeof startDevelopmentApp>>|undefined,failed=false;
const observations:Record<string,unknown>[]=[];
function observe(id:string,evidence:Record<string,unknown>){const v={id,status:'REPRODUCED_OPEN_NOT_FIXED',...evidence};observations.push(v);console.log('AUDIT_OBSERVATION '+JSON.stringify(v));}
try{
 app=await startDevelopmentApp({built:true});await seedRecommendation(app.db.pool);await bootstrapDevelopmentAdmin(app.db.pool,{email:'audit-open-bootstrap@example.invalid',displayName:'合成初期ADMIN',password});const {origin}=app;
 async function clock(value:string){await app!.db.pool.query(`CREATE OR REPLACE FUNCTION inventory_clock() RETURNS timestamptz LANGUAGE sql VOLATILE AS $$SELECT '${new Date(value).toISOString()}'::timestamptz$$`);}
 await clock('2035-07-01T10:00:00+09:00');
 for(let i=0;i<100;i++){try{if((await fetch(origin+'/api/health')).ok)break;}catch{}if(i===99)throw new Error('APP_START_TIMEOUT');await new Promise(r=>setTimeout(r,100));}
 async function login(email:string){const c=await browser.newContext({baseURL:origin});c.setDefaultTimeout(10000);const p=await c.newPage();await p.goto('/staff/login');await p.getByLabel('メールアドレス',{exact:true}).fill(email);await p.getByLabel('パスワード',{exact:true}).fill(password);await p.getByRole('button',{name:'ログイン',exact:true}).click();await p.waitForURL(origin+'/staff/ledger');return {c,p};}
 const root=await login('audit-open-bootstrap@example.invalid');
 const common:AccountSettings={displayName:'合成設定対象',active:true,role:'STAFF',scope:'ASSIGNED',storeIds:['MOUNTAIN_BASE'],permissions:{INVENTORY_VIEW:true,INVENTORY_EDIT:true,HOLD_VIEW:true,HOLD_EDIT:true}};
 async function create(email:string,settings:AccountSettings){const r=await root.c.request.post('/api/staff-users',{headers:{origin},data:{...settings,email,password}});assert.equal(r.status(),201);return (await r.json()).id as string;}
 const subject=await create('audit-open-subject@example.invalid',common);
 await create('audit-open-admin@example.invalid',{...common,displayName:'合成第2管理者',role:'ADMIN',scope:'ALL',storeIds:[],permissions:{...common.permissions,STAFF_MANAGE:true,TRANSFER_VIEW:true,TRANSFER_PLAN:true,TRANSFER_DISPATCH:true,TRANSFER_RECEIVE:true}});
 const other=await login('audit-open-admin@example.invalid');
 // A: hold the original actual form open while the other administrator disables/revokes.
 await root.p.goto('/staff/users');await root.p.getByRole('button',{name:'スタッフを編集：合成設定対象'}).click();
 const form=root.p.getByRole('form',{name:'スタッフ更新'});await expect(form.getByLabel('有効',{exact:true})).toBeChecked();
 const disabled={...common,active:false,permissions:{...common.permissions,INVENTORY_EDIT:false}};
 assert.equal((await other.c.request.patch('/api/staff-users/'+subject,{headers:{origin},data:disabled})).status(),200);
 const before=(await app.db.pool.query('SELECT active,revision FROM staff_members WHERE id=$1',[subject])).rows[0];assert.equal(before.active,false);
 await form.getByRole('button',{name:'スタッフ設定を保存'}).click();await expect(form).toHaveCount(0);
 const after=(await app.db.pool.query('SELECT active,revision FROM staff_members WHERE id=$1',[subject])).rows[0];const restored=(await app.db.pool.query("SELECT allowed FROM staff_permission_overrides WHERE staff_id=$1 AND permission='INVENTORY_EDIT'",[subject])).rows[0].allowed;
 assert.equal(after.active,true);assert.equal(restored,true);observe('A',{mode:'ordinary UI + API + real PostgreSQL',beforeActive:before.active,afterActive:after.active,editRestored:restored,revisionIncreased:after.revision>before.revision});
 // B: observe this run's actual lock wait before committing permission revocation, then release it.
 const actor=await login('audit-open-subject@example.invalid');const asset=fid(1201);const detail=await (await actor.c.request.get('/api/ledger/assets/'+asset)).json();const lock=await app.db.pool.connect();let pending:ReturnType<BrowserContext['request']['patch']>|undefined;
 try{await lock.query('BEGIN');await lock.query('SELECT pg_advisory_xact_lock(71820600)');pending=actor.c.request.patch('/api/ledger/assets/'+asset,{headers:{origin},data:{version:detail.version,reason:'SYNTHETIC permission wait audit',notes:'audit operation admitted before revocation'}});
  await expect.poll(async()=>Number((await app!.db.pool.query("SELECT count(*) AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event='advisory' AND query='SELECT pg_advisory_xact_lock(71820600)'" )).rows[0].n),{timeout:1000,intervals:[20]}).toBeGreaterThan(0);
  assert.equal((await other.c.request.patch('/api/staff-users/'+subject,{headers:{origin},data:{...common,permissions:{...common.permissions,INVENTORY_EDIT:false}}})).status(),200);
 }finally{await lock.query('ROLLBACK');lock.release();}
 assert.ok(pending);const result=await pending;assert.equal(result.status(),200);const stored=(await app.db.pool.query('SELECT notes FROM ledger_assets WHERE id=$1',[asset])).rows[0].notes;assert.equal(stored,'audit operation admitted before revocation');observe('B',{mode:'normal authenticated API + real PostgreSQL lock race',writeAfterRevocationStatus:result.status(),storedAfterRevoke:true});
 async function edit(resource:string,id:string,patch:Record<string,unknown>){const prior=await (await other.c.request.get('/api/ledger/'+resource+'/'+id)).json();return other.c.request.patch('/api/ledger/'+resource+'/'+id,{headers:{origin},data:{version:prior.version,reason:'SYNTHETIC open audit observation',...patch}});}
 // C: effective expiry read does not reconcile physical active claims before a ledger mutation.
 const h=await (await other.c.request.post('/api/holds',{headers:{origin},data:{requestKey:randomUUID(),conditions:skiSet('2035-07-02')}})).json();assert.equal(h.result,'CREATED');await clock('2035-07-01T10:11:00+09:00');const expired=await (await other.c.request.get('/api/holds/'+h.holdId)).json();assert.equal(expired.state,'EXPIRED');const claims=Number((await app.db.pool.query('SELECT count(*) AS n FROM inventory_claims WHERE hold_id=$1 AND active',[h.holdId])).rows[0].n);const assetBlocked=await edit('assets',asset,{status:'MAINTENANCE'}),poleBlocked=await edit('poles',fid(1301),{quantity:0});assert.equal(assetBlocked.status(),422);assert.equal(poleBlocked.status(),422);observe('C',{mode:'normal authenticated API + real PostgreSQL',effectiveHoldState:expired.state,activeClaims:claims,assetMaintenanceStatus:assetBlocked.status(),poleReductionStatus:poleBlocked.status()});
 // D: normal dispatch/receipt/readiness completes, but the unreferenced READY witness remains blocking.
 async function transfer(path:string,input:unknown){const r=await other.c.request.post('/api/transfers'+path,{headers:{origin},data:{requestKey:randomUUID(),input}});assert.equal(r.status(),path?200:201);return r.json();}
 const t=await transfer('',{sourceStore:'MOUNTAIN_BASE',destinationStore:'ONSEN_BASE',scheduledDate:'2035-07-03',plannedReadyAt:'2035-07-03T19:00:00+09:00',neededBy:'2035-07-04T08:30:00+09:00',basis:'SYNTHETIC open audit',lines:[{assetId:fid(1204)},{poleId:fid(1301),quantity:1}]});await clock('2035-07-03T17:00:00+09:00');await transfer('/'+t.batch.id+'/dispatch',{});await clock('2035-07-03T17:12:00+09:00');const pieceIds=t.batch.pieces.map((p:{id:string})=>p.id);await transfer('/'+t.batch.id+'/receive',{pieceIds});assert.equal((await edit('assets',fid(1204),{status:'AVAILABLE'})).status(),200);await transfer('/'+t.batch.id+'/ready',{pieceIds});
 const ready=(await app.db.pool.query('SELECT id,state,destination_pole_id FROM transfer_pieces WHERE batch_id=$1 ORDER BY id',[t.batch.id])).rows;const readyClaims=Number((await app.db.pool.query('SELECT count(*) AS n FROM inventory_claims WHERE active AND transfer_piece_id=ANY($1::uuid[])',[pieceIds])).rows[0].n);assert.equal(readyClaims,0);const maintenance=await edit('assets',fid(1204),{status:'MAINTENANCE'}),quantity=await edit('poles',ready.find(p=>p.destination_pole_id).destination_pole_id,{quantity:0});assert.equal(maintenance.status(),422);assert.equal(quantity.status(),422);observe('D',{mode:'normal authenticated API + real PostgreSQL',pieceStates:ready.map(p=>p.state),activeReferencingClaims:readyClaims,assetMaintenanceStatus:maintenance.status(),poleReductionStatus:quantity.status()});
 // E: pure original solver, known shortage by pigeonhole, but search limit wins.
 const units=Array.from({length:9},(_,i)=>'unit-'+i),demands=Array.from({length:10},(_,i)=>({key:'person-'+i,start:'2035-08-01',end:'2035-08-01',candidates:units}));let outcome='';try{outcome=matchPeriods(demands,new Map(units.map(u=>[u,1])),[])===null?'INSUFFICIENT':'FEASIBLE';}catch(e){if(!(e instanceof HoldError))throw e;outcome=e.code;}assert.equal(outcome,'INDETERMINATE');observe('E',{mode:'pure solver reproduction, not HTTP/DB load',units:9,members:10,days:1,candidatesPerMember:9,outcome,knownShortageProof:'10 simultaneous distinct single-capacity placements cannot fit9 units'});
 // F: schema-valid maximum direct payload exceeds the common actual HTTP parser's byte cap.
 const conditions=skiSet('2035-08-02');conditions.members=Array.from({length:20},(_,i)=>({...structuredClone(conditions.members[0]!),key:('member-'+i).padEnd(24,'x'),items:conditions.members[0]!.items.map(item=>({...item,variantIds:Array.from({length:6},()=>randomUUID())}))}));parseConditions(conditions);const body=JSON.stringify({requestKey:randomUUID(),conditions});let httpCode=0;try{await readJson(new Request('http://localhost/api/holds',{method:'POST',headers:{'content-type':'application/json'},body}));}catch(e){httpCode=(e as {status:number}).status;}assert.equal(httpCode,413);observe('F',{mode:'actual schema + HTTP parser unit reproduction; IDs syntactically valid, DB existence not asserted',members:20,componentsPerMember:3,variantsPerComponent:6,utf8Bytes:Buffer.byteLength(body),limit:16384,status:httpCode});
 console.log('AUDIT_PROBES_COMPLETED '+observations.length+' open observations; not acceptance passes, no fixes to A-G.');
}catch(e){failed=true;console.error('AUDIT_PROBE_INCOMPLETE '+(e as Error).name);console.error((e as Error).stack?.split('\n').filter(l=>l.includes('/tests/recommendation/audit-observations.ts:')).join('\n'));}finally{await browser.close();if(app)await app.stop();console.log('Owned audit-observation Web, browser and PostgreSQL stopped.');}if(failed)process.exit(1);
