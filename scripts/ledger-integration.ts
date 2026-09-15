import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import type {Pool,PoolClient} from 'pg';
import {migrate,seed,migrationsDirectory} from '@rental/db';
import {LedgerService} from '../packages/core/src/catalog/ledger-service';
import {LedgerError,type LedgerPrincipal,type Resource,type LedgerDetail} from '../packages/contracts/src/ledger';
import {ledgerHandler} from '../apps/web/src/lib/ledger-http';
import {seedLedgerSample} from '../tests/fixtures/seed-ledger';
import {SAMPLE,fixtureId as id} from '../tests/fixtures/ledger-sample';
import {startIsolatedPostgres} from './postgres';
const admin:LedgerPrincipal={subject:'test-admin',role:'ADMIN',storeIds:['MOUNTAIN_BASE','ONSEN_BASE']};
let count=0;
async function check(name:string,fn:()=>Promise<void>){await fn();count++;console.log('PASS '+name);}
async function raw(pool:Pool,fn:(c:PoolClient)=>Promise<unknown>){const c=await pool.connect();try{await c.query('BEGIN');await c.query("SELECT set_config('zao.actor','db-test',true),set_config('zao.reason','synthetic constraint test',true)");const value=await fn(c);await c.query('COMMIT');return value;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
function request(path:string,method='GET',body?:unknown){return new Request('http://ledger.test/api/ledger/'+path,{method,headers:{origin:'http://ledger.test','content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});}
const db=await startIsolatedPostgres();
try {
  const service=new LedgerService(db.pool,admin,async()=>{/* Explicit synthetic fixture boundary; normal runtime uses verifyLedgerWrite. */},async()=>{/* Explicit fixture-only lifecycle boundary; normal runtime uses reconcileLedgerProtection. */});const http=ledgerHandler(async()=>admin,p=>new LedgerService(db.pool,p,async()=>{/* Explicit synthetic fixture boundary; normal runtime uses verifyLedgerWrite. */},async()=>{/* Explicit fixture-only lifecycle boundary; normal runtime uses reconcileLedgerProtection. */}));
  await check('ordered concurrent migrations apply 0001 through 0029 exactly once',async()=>{await Promise.all([migrate(db.pool),migrate(db.pool)]);assert.deepEqual((await db.pool.query('SELECT id FROM foundation_migrations ORDER BY id')).rows,[{id:'0001'},{id:'0002'},{id:'0003'},{id:'0004'},{id:'0005'},{id:'0006'},{id:'0007'},{id:'0008'},{id:'0009'},{id:'0010'},{id:'0011'},{id:'0012'},{id:'0013'},{id:'0014'},{id:'0015'},{id:'0016'},{id:'0017'},{id:'0018'},{id:'0019'},{id:'0020'},{id:'0021'},{id:'0022'},{id:'0023'},{id:'0024'},{id:'0025'},{id:'0026'},{id:'0027'},{id:'0028'},{id:'0029'}]);});
  await check('traceable synthetic sample is atomic and concurrent replay creates no duplicates or audit events',async()=>{
    await seedLedgerSample(db.pool);const before=(await db.pool.query('SELECT count(*)::int AS n FROM ledger_history')).rows[0].n;
    await Promise.all([seedLedgerSample(db.pool),seedLedgerSample(db.pool)]);
    assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM ledger_history')).rows[0].n,before);
    assert.equal((await service.list('assets')).total,6);assert.equal((await service.list('models')).total,6);assert.equal((await service.list('variants')).total,8);
    for(const asset of (await service.list('assets')).items){assert.equal(asset.sourceKind,'SYNTHETIC');assert.equal(asset.sourceDocument,'tests/fixtures/ledger-sample.ts');assert.match(asset.sourceLocator,/^assets\//);}
  });
  const cloneAsset=async(c:PoolClient,newId:string,locator:string,variant=id(101),family='SKI',bsl='NOT_APPLICABLE')=>c.query(`INSERT INTO ledger_assets(id,variant_id,family,initial_store_id,store_id,status,bsl_status,bsl_mm,bsl_evidence,notes,source_kind,source_document,source_locator) VALUES($1,$2,$3,'MOUNTAIN_BASE','MOUNTAIN_BASE','UNVERIFIED',$4,NULL,'','','SYNTHETIC','tests/fixtures/ledger-sample.ts',$5)`,[newId,variant,family,bsl,locator]);
  await check('duplicate Asset UUID and duplicate pair source are rejected by PostgreSQL',async()=>{
    await assert.rejects(raw(db.pool,c=>cloneAsset(c,id(201),'duplicate-id')),{code:'23505'});
    await assert.rejects(raw(db.pool,c=>cloneAsset(c,randomUUID(),'assets/201')),{code:'23505'});
  });
  await check('two ski labels reference one pair; boards and boot pairs are one Asset each',async()=>{
    const ski=await service.get('assets',id(201));assert.equal(ski.labelCopies,2);assert.equal(ski.code,ski.id);assert.equal(ski.unit,'PAIR');
    assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM ledger_assets WHERE label_code=$1',[ski.code])).rows[0].n,1);
    assert.equal((await service.get('assets',id(204))).unit,'BOARD');assert.equal((await service.get('assets',id(205))).unit,'PAIR');
  });
  await check('product / variant / family / Asset references reject missing or mismatched parents',async()=>{
    await assert.rejects(raw(db.pool,c=>cloneAsset(c,randomUUID(),'missing-variant',randomUUID())),{code:'23503'});
    await assert.rejects(raw(db.pool,c=>cloneAsset(c,randomUUID(),'wrong-family',id(101),'SKI_BOOT','UNVERIFIED')),{code:'23503'});
    await assert.rejects(raw(db.pool,c=>c.query("UPDATE ledger_variants SET model_id=$1 WHERE id=$2",[randomUUID(),id(101)])),{code:'23514'});
    await assert.rejects(service.create('variants',{...SAMPLE.variants[0].data,modelId:randomUUID(),sourceLocator:'missing-model'}),{code:'CONSTRAINT_VIOLATION'});
    await assert.rejects(service.create('variants',{...SAMPLE.variants[0].data,modelId:id(2),sourceLocator:'wrong-model-family'}),{code:'CONSTRAINT_VIOLATION'});
  });
  await check('set definitions expose exact components without creating any physical stock',async()=>{
    const before=(await service.list('assets')).total;const poles=(await service.list('poles')).items.map(p=>p.quantity);
    const ski=await service.get('bundles',id(401));assert.deepEqual(ski.components,[{family:'POLE',quantity:1,unit:'PAIR'},{family:'SKI',quantity:1,unit:'PAIR'},{family:'SKI_BOOT',quantity:1,unit:'PAIR'}]);
    assert.deepEqual((await service.get('bundles',id(402))).components,[{family:'SNOWBOARD',quantity:1,unit:'BOARD'},{family:'SNOWBOARD_BOOT',quantity:1,unit:'PAIR'}]);
    await service.create('bundles',{...SAMPLE.bundles[0].data,code:'TEST-SET',sourceLocator:'new-set'});
    assert.equal((await service.list('assets')).total,before);assert.deepEqual((await service.list('poles')).items.map(p=>p.quantity),poles);
    await assert.rejects(raw(db.pool,c=>c.query('UPDATE ledger_bundles SET sales_enabled=true WHERE id=$1',[id(401)])),{code:'23514'});
  });
  await check('pole quantities count pairs, reject negatives in SQL and reject fractional API input',async()=>{
    const poles=await service.list('poles');assert.equal(poles.items.reduce((sum,p)=>sum+p.quantity!,0),10);assert.ok(poles.items.every(p=>p.unit==='PAIR'));
    await assert.rejects(raw(db.pool,c=>c.query('UPDATE ledger_poles SET quantity=-1 WHERE id=$1',[id(301)])),{code:'23514'});
    await assert.rejects(service.update('poles',id(301),{version:1,reason:'test',quantity:0.5}),{code:'INVALID_INPUT'});
  });
  await check('unknown ski BSL stays null; recorded BSL needs source; snowboard boots need no alpine BSL',async()=>{
    const boot=await service.get('assets',id(205));assert.equal(boot.bslStatus,'UNVERIFIED');assert.equal(boot.bslMm,null);
    await assert.rejects(service.update('assets',boot.id,{version:1,reason:'test',bslStatus:'RECORDED',bslMm:309,bslEvidence:''}),{code:'CONSTRAINT_VIOLATION'});
    const recorded=await service.update('assets',boot.id,{version:1,reason:'simulated physical reading',bslStatus:'RECORDED',bslMm:309,bslEvidence:'SYNTHETIC TEST: simulated marking; not real equipment'});assert.equal(recorded.bslMm,309);
    const sb=await service.get('assets',id(206));assert.equal(sb.bslStatus,'NOT_APPLICABLE');assert.equal(sb.bslMm,null);
    await assert.rejects(service.update('assets',sb.id,{version:1,reason:'test',bslStatus:'RECORDED',bslMm:309,bslEvidence:'test'}),{code:'CONSTRAINT_VIOLATION'});
    assert.equal(recorded.status,'UNVERIFIED');assert.ok(!('din' in recorded));
  });
  await check('Asset identity/custody/category cannot be rewritten; initial store history survives updates',async()=>{
    for(const statement of ['UPDATE ledger_assets SET id=gen_random_uuid() WHERE id=$1',"UPDATE ledger_assets SET store_id='ONSEN_BASE',initial_store_id='ONSEN_BASE' WHERE id=$1"])
      await assert.rejects(raw(db.pool,c=>c.query(statement,[id(201)])),{code:'23514'});
    for(const field of ['age','tier','size'])await assert.rejects(raw(db.pool,c=>c.query(`UPDATE ledger_variants SET ${field}=$1 WHERE id=$2`,[field==='age'?'KIDS':field==='tier'?'PREMIUM':'999 cm',id(101)])),{code:'23514'});
    const row=await service.update('assets',id(201),{version:1,reason:'test note correction',notes:'SYNTHETIC: paired labels checked'});
    assert.equal(row.storeId,'MOUNTAIN_BASE');assert.equal(row.locations.length,1);assert.equal(row.locations[0]!.event,'INITIAL_REGISTRATION');assert.equal(row.locations[0]!.storeId,'MOUNTAIN_BASE');
    await assert.rejects(service.update('assets',row.id,{version:2,reason:'move',storeId:'ONSEN_BASE'}),{code:'INVALID_INPUT'});
  });
  await check('optimistic update concurrency accepts only one writer and audits only committed changes',async()=>{
    const row=await service.get('assets',id(204));const results=await Promise.allSettled(['a','b'].map(notes=>service.update('assets',row.id,{version:row.version,reason:'parallel synthetic test',notes})));
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);const rejected=results.find(r=>r.status==='rejected');assert.ok(rejected?.status==='rejected'&&rejected.reason instanceof LedgerError&&rejected.reason.code==='STALE_VERSION');
    const next=await service.get('assets',row.id);assert.equal(next.version,row.version+1);assert.equal(next.history.length,2);assert.equal(next.history[1]!.actor,'test-admin');
  });
  await check('store/sport/age/tier/size/state search returns only exact ledger matches without substitution',async()=>{
    const found=await service.list('assets',{storeId:'MOUNTAIN_BASE',sport:'SKI',age:'ADULT',tier:'REGULAR',size:'160 cm',status:'UNVERIFIED'});assert.equal(found.total,1);assert.equal(found.items[0]!.id,id(201));assert.equal(found.quantityMeaning,'LEDGER_ONLY_NOT_RESERVABLE');
    assert.equal((await service.list('assets',{storeId:'MOUNTAIN_BASE',sport:'SKI',age:'KIDS',tier:'PREMIUM'})).total,0);
    assert.equal((await service.list('assets',{q:"%' OR 1=1 --"})).total,0);
    assert.equal((await service.list('assets',{offset:100})).items.length,0);assert.equal((await service.list('assets',{offset:100})).total,6);
  });
  await check('real-DB HTTP boundary rejects anonymous, customer, read-only staff and out-of-store access',async()=>{
    const anonymous=ledgerHandler(async()=>null,p=>new LedgerService(db.pool,p,async()=>{/* Explicit synthetic fixture boundary; normal runtime uses verifyLedgerWrite. */},async()=>{/* Explicit fixture-only lifecycle boundary; normal runtime uses reconcileLedgerProtection. */}));assert.equal((await anonymous(request('assets','POST',SAMPLE.assets[0].data))).status,401);
    const customer=ledgerHandler(async()=>({subject:'test-customer',role:'CUSTOMER',storeIds:['MOUNTAIN_BASE']}),p=>new LedgerService(db.pool,p,async()=>{/* Explicit synthetic fixture boundary; normal runtime uses verifyLedgerWrite. */},async()=>{/* Explicit fixture-only lifecycle boundary; normal runtime uses reconcileLedgerProtection. */}));assert.equal((await customer(request('assets'))).status,403);
    const staff=ledgerHandler(async()=>({subject:'test-staff',role:'STAFF',storeIds:['MOUNTAIN_BASE']}),p=>new LedgerService(db.pool,p,async()=>{/* Explicit synthetic fixture boundary; normal runtime uses verifyLedgerWrite. */},async()=>{/* Explicit fixture-only lifecycle boundary; normal runtime uses reconcileLedgerProtection. */}));
    assert.equal((await staff(request('assets','POST',SAMPLE.assets[0].data))).status,403);
    assert.equal((await staff(request('assets/'+id(202)))).status,404);assert.equal((await staff(request('assets?storeId=ONSEN_BASE'))).status,403);
    const allowed=await staff(request('assets'));assert.equal(allowed.status,200);assert.ok((await allowed.json()).items.every((r:{storeId:string})=>r.storeId==='MOUNTAIN_BASE'));
  });
  await check('HTTP registration, reload and versioned update retain source and full history',async()=>{
    const response=await http(request('assets','POST',{...SAMPLE.assets[0].data,sourceLocator:'http-new-asset'}));assert.equal(response.status,201);const created=await response.json() as LedgerDetail;
    const reloaded=await (await http(request('assets/'+created.id))).json() as LedgerDetail;assert.equal(reloaded.id,created.id);assert.equal(reloaded.code,created.id);assert.equal(reloaded.history.length,1);
    const update=await http(request('assets/'+created.id,'PATCH',{version:1,reason:'HTTP correction',notes:'SYNTHETIC updated'}));assert.equal(update.status,200);
    const final=await (await http(request('assets/'+created.id))).json() as LedgerDetail;assert.equal(final.notes,'SYNTHETIC updated');assert.equal(final.version,2);assert.equal(final.history.length,2);assert.equal(final.sourceLocator,'http-new-asset');
    assert.equal((await http(request('assets/'+created.id,'PATCH',{version:1,reason:'old edit',notes:'stale'}))).status,409);
    assert.equal((await http(request('assets','POST',{...SAMPLE.assets[0].data,sourceLocator:'http-new-asset'}))).status,409);
  });
  await check('every catalogue resource supports protected read/create/basic update and retains identity fields',async()=>{
    for(const resource of ['models','variants','poles','bundles'] as Resource[]){const original=await service.get(resource,resource==='models'?id(1):resource==='variants'?id(101):resource==='poles'?id(301):id(401));
      const update=await http(request(`${resource}/${original.id}`,'PATCH',{version:original.version,reason:'basic note update',notes:'SYNTHETIC resource update'}));assert.equal(update.status,200);assert.equal((await service.get(resource,original.id)).version,original.version+1);
    }
    const model=await service.create('models',{...SAMPLE.models[0].data,code:'HTTP-MODEL',sourceLocator:'new-model'});assert.equal(model.family,'SKI');
    const variant=await service.create('variants',{...SAMPLE.variants[0].data,modelId:model.id,sourceLocator:'new-variant'});assert.equal(variant.modelId,model.id);
    const pole=await service.create('poles',{...SAMPLE.poles[0].data,storeId:'ONSEN_BASE',sourceLocator:'new-pole-pool'});assert.equal(pole.quantity,6);
    await assert.rejects(service.create('variants',{...SAMPLE.variants[0].data,modelId:id(6),family:'WEAR',sourceLocator:'wear-unit-unapproved'}),{code:'INVALID_INPUT'});
  });
  await check('malformed/oversized/origin-forged inputs and protected history writes are rejected',async()=>{
    assert.equal((await http(request('assets','POST',{...SAMPLE.assets[0].data,admin:true}))).status,422);
    assert.equal((await http(request('assets?available=true'))).status,422);assert.equal((await http(request('assets?age=ADULT&age=KIDS'))).status,422);
    assert.equal((await http(new Request('http://ledger.test/api/ledger/assets',{method:'POST',headers:{origin:'http://attacker.invalid','content-type':'application/json'},body:'{}'}))).status,403);
    assert.equal((await http(new Request('http://ledger.test/api/ledger/assets',{method:'POST',headers:{origin:'http://ledger.test','content-type':'application/json'},body:'x'.repeat(16385)}))).status,413);
    await assert.rejects(db.pool.query("INSERT INTO ledger_history(resource,entity_id,action,actor,reason,before_data,after_data) SELECT resource,entity_id,action,actor,reason,before_data,after_data FROM ledger_history LIMIT 1"),{code:'23514'});
    await assert.rejects(db.pool.query("INSERT INTO ledger_locations(asset_id,store_id,event) SELECT asset_id,store_id,event FROM ledger_locations LIMIT 1"),{code:'23514'});
    await assert.rejects(db.pool.query("UPDATE ledger_history SET reason='erased'"),{code:'23514'});await assert.rejects(db.pool.query('DELETE FROM ledger_locations'),{code:'23514'});
    await assert.rejects(raw(db.pool,c=>c.query('DELETE FROM ledger_assets WHERE id=$1',[id(201)])),{code:'23514'});
  });
  await check('size format variants collide within one model/age/tier and size filters use the same key',async()=>{
    const before=(await service.list('variants')).total;
    for(const size of ['160CM','160 Cm','160   cm'])await assert.rejects(service.create('variants',{...SAMPLE.variants[0].data,size,sourceLocator:'size-format-'+size}),{code:'DUPLICATE_RECORD'});
    const duplicate=await http(request('variants','POST',{...SAMPLE.variants[0].data,size:'160CM',sourceLocator:'http-size-format'}));
    assert.equal(duplicate.status,409);assert.deepEqual(await duplicate.json(),{error:'DUPLICATE_RECORD'});
    await assert.rejects(raw(db.pool,c=>c.query(`INSERT INTO ledger_variants(id,model_id,family,age,tier,size,notes,source_kind,source_document,source_locator) VALUES($1,$2,'SKI','ADULT','REGULAR','160CM','','SYNTHETIC','review-regression','raw-size-format')`,[randomUUID(),id(1)])),{code:'23505'});
    assert.equal((await service.list('variants')).total,before);
    const exact=await service.list('assets',{size:'160 cm'});const alternate=await service.list('assets',{size:'160CM'});
    assert.equal(alternate.total,exact.total);assert.ok(exact.total>0);assert.deepEqual(alternate.items.map(r=>r.id),exact.items.map(r=>r.id));
    const premium=await service.create('variants',{...SAMPLE.variants[0].data,size:'160CM',tier:'PREMIUM',sourceLocator:'distinct-tier-size'});
    assert.equal(premium.tier,'PREMIUM');assert.notEqual(premium.id,id(101));
  });
  await check('provenance is unique within a resource and may cite the same source across model and Asset',async()=>{
    const asset=await service.get('assets',id(201));const input={...SAMPLE.models[0].data,code:'SHARED-CITATION',sourceDocument:asset.sourceDocument,sourceLocator:asset.sourceLocator};
    const model=await service.create('models',input);const loaded=await service.get('models',model.id);
    assert.equal(loaded.sourceDocument,asset.sourceDocument);assert.equal(loaded.sourceLocator,asset.sourceLocator);
    assert.equal(loaded.history.length,1);assert.equal((await service.get('assets',asset.id)).history.length,asset.history.length);
    await assert.rejects(service.create('models',{...input,code:'SHARED-CITATION-DUP'}),{code:'DUPLICATE_RECORD'});
  });
  await check('HTTP rejects an Asset family that mismatches its variant and leaves no row or audit record',async()=>{
    const before=(await service.list('assets')).total;const history=(await db.pool.query('SELECT count(*)::int AS n FROM ledger_history')).rows[0].n;
    const response=await http(request('assets','POST',{...SAMPLE.assets[0].data,family:'SNOWBOARD',sourceLocator:'http-family-mismatch'}));
    assert.equal(response.status,422);assert.deepEqual(await response.json(),{error:'CONSTRAINT_VIOLATION'});
    assert.equal((await service.list('assets')).total,before);assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM ledger_history')).rows[0].n,history);
  });
  await check('out-of-store update takes no Asset or pole row lock and cannot block the owning store',async()=>{
    for(const [resource,recordId,table] of [['assets',id(202),'ledger_assets'],['poles',id(302),'ledger_poles']] as const){
      const prior=await service.get(resource,recordId);const client=await db.pool.connect();const original=client.query;const query=client.query.bind(client);
      let signal!:()=>void;let release!:()=>void;const reached=new Promise<void>(r=>{signal=r;});const gate=new Promise<void>(r=>{release=r;});
      // The gate pauses a real PostgreSQL transaction after its scoped read (before any permitted lock); not a mock DB.
      client.query=(async(text:string,values?:unknown[])=>{const result=await query(text,values);if(text.includes('SELECT id FROM')&&text.includes(table)){signal();await gate;}return result;}) as PoolClient['query'];
      const controlledPool={connect:async()=>client} as unknown as Pool;
      const outsider=new LedgerService(controlledPool,{subject:'other-store-admin',role:'ADMIN',storeIds:['MOUNTAIN_BASE']},async()=>{/* Explicit synthetic fixture boundary; normal runtime uses verifyLedgerWrite. */},async()=>{/* Explicit fixture-only lifecycle boundary; normal runtime uses reconcileLedgerProtection. */});
      const attempt=outsider.update(resource,recordId,{version:prior.version,reason:'out-of-scope counterexample',notes:'must not be written'}).then(()=>undefined,e=>e as LedgerError);
      try {
        await Promise.race([reached,attempt.then(()=>{throw new Error('Scoped authorization probe was not reached');})]);
        // NOWAIT gives an immediate, deterministic failure if the outsider locked this real row.
        await raw(db.pool,c=>c.query(`SELECT id FROM ${table} WHERE id=$1 FOR UPDATE NOWAIT`,[recordId]));
        const owner=new LedgerService(db.pool,{subject:'owning-store-admin',role:'ADMIN',storeIds:['ONSEN_BASE']},async()=>{/* Explicit synthetic fixture boundary; normal runtime uses verifyLedgerWrite. */},async()=>{/* Explicit fixture-only lifecycle boundary; normal runtime uses reconcileLedgerProtection. */});
        const updated=await owner.update(resource,recordId,{version:prior.version,reason:'legitimate concurrent update',notes:'SYNTHETIC owner update'});
        assert.equal(updated.version,prior.version+1);
      } finally {client.query=original;release();const denial=await attempt;assert.equal(denial?.code,'NOT_FOUND');assert.equal(denial?.status,404);}
      const final=await service.get(resource,recordId);assert.equal(final.history.at(-1)!.actor,'owning-store-admin');
    }
  });
  await check('sample checksum mismatch is not silently imported as replacement inventory',async()=>{
    await db.pool.query("UPDATE ledger_import_receipts SET checksum=repeat('0',64)");await assert.rejects(seedLedgerSample(db.pool),/checksum drift/);
  });
}finally{await db.stop();console.log('Owned ledger PostgreSQL process stopped.');}
const upgrade=await startIsolatedPostgres();
try {
  await check('failed 0002 upgrade preserves 0001 data, releases lock, then recovers without schema destruction',async()=>{
    const original=await readFile(migrationsDirectory+'/0001_foundation.sql','utf8');
    await upgrade.pool.query('CREATE TABLE foundation_migrations(id text PRIMARY KEY,checksum text NOT NULL)');await upgrade.pool.query(original);
    await upgrade.pool.query('INSERT INTO foundation_migrations VALUES($1,$2)',['0001',createHash('sha256').update(original).digest('hex')]);await seed(upgrade.pool,upgrade.identity.namespace);
    const observer=await upgrade.pool.connect();try{
      await observer.query("CREATE TABLE ledger_assets(sentinel text); INSERT INTO ledger_assets VALUES('owned collision')");
      await assert.rejects(migrate(upgrade.pool),{code:'42P07'});
      assert.equal((await observer.query('SELECT count(*)::int AS n FROM foundation_metadata')).rows[0].n,1);
      assert.deepEqual((await observer.query('SELECT id FROM foundation_migrations')).rows,[{id:'0001'}]);assert.equal((await observer.query("SELECT to_regclass('ledger_models') AS table_name")).rows[0].table_name,null);
      await observer.query('BEGIN');try{assert.equal((await observer.query('SELECT pg_try_advisory_xact_lock(71820401) AS acquired')).rows[0].acquired,true);}finally{await observer.query('ROLLBACK');}
      assert.equal((await observer.query('SELECT sentinel FROM ledger_assets')).rows[0].sentinel,'owned collision');await observer.query('DROP TABLE ledger_assets');
    }finally{observer.release();}
    await migrate(upgrade.pool);await migrate(upgrade.pool);assert.equal((await upgrade.pool.query('SELECT count(*)::int AS n FROM foundation_metadata')).rows[0].n,1);
    await upgrade.pool.query("INSERT INTO foundation_migrations VALUES('9999','unknown')");await assert.rejects(migrate(upgrade.pool),/supported prefix/);
  });
}finally{await upgrade.stop();console.log('Owned ledger-upgrade PostgreSQL process stopped.');}
console.log(`Ledger integration: ${count} passed; 0 skipped. Synthetic samples only; no booking/fit/auth-provider claims.`);
