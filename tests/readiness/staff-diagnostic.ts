import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {request,type APIRequestContext} from '@playwright/test';
import {startFlowApp} from '../flow/launcher';
import {bootstrapDevelopmentAdmin} from '../../scripts/bootstrap-staff';
let app:Awaited<ReturnType<typeof startFlowApp>>|undefined,client:APIRequestContext|undefined;
const captured:string[]=[],original=console.error;console.error=(...values:unknown[])=>{for(const v of values)if(typeof v==='string')captured.push(v);};
try{
 app=await startFlowApp({publicP0:true});const password=randomBytes(24).toString('base64url');
 await bootstrapDevelopmentAdmin(app.db.pool,{email:'diagnostic-admin@example.invalid',displayName:'SYNTHETIC Diagnostic',password});
 client=await request.newContext({baseURL:app.origin});
 const signed=await client.post('/api/auth/sign-in/email',{headers:{origin:app.origin},data:{email:'diagnostic-admin@example.invalid',password}});assert.equal(signed.status(),200);
 // Test-owned operator connection only; no product flag, migration edit or stronger app role.
 await app.db.pool.query(`CREATE FUNCTION synthetic_staff_failure() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='SYNTHETIC_PRIVATE_DB_MESSAGE',DETAIL='SYNTHETIC_PRIVATE_DB_DETAIL';END$$; CREATE TRIGGER synthetic_staff_failure BEFORE INSERT ON staff_members FOR EACH ROW EXECUTE FUNCTION synthetic_staff_failure()`);
 const response=await client.post('/api/staff-users',{headers:{origin:app.origin},data:{email:'diagnostic-staff@example.invalid',password,displayName:'SYNTHETIC Staff',active:true,role:'VIEWER',scope:'ASSIGNED',storeIds:['MOUNTAIN_BASE'],permissions:{}}});
 assert.equal(response.status(),500);assert.deepEqual(await response.json(),{error:'STAFF_OPERATION_FAILED'});
 assert.equal((await app.db.pool.query('SELECT count(*)::int n FROM auth_user WHERE email=$1',['diagnostic-staff@example.invalid'])).rows[0].n,0);
 await app.stop();await new Promise<void>(resolve=>setImmediate(resolve));
 const records=captured.flatMap(line=>{try{const v=JSON.parse(line);return v.code==='STAFF_OPERATION_DIAGNOSTIC'?[v]:[];}catch{return [];}});
 assert.equal(records.length,1,'STAFF_DIAGNOSTIC_NOT_FORWARDED');
 assert.deepEqual(Object.keys(records[0]).sort(),['category','code','correlationId','phase']);assert.equal(records[0].phase,'WRITE');assert.equal(records[0].category,'23514');assert.match(records[0].correlationId,/^[0-9a-f-]{36}$/);
 assert.ok(!captured.join(' ').includes('SYNTHETIC_PRIVATE'));assert.ok(!captured.join(' ').includes(password));
 console.log('PASS ordinary password HTTP -> protected staff POST -> owned real-PG injected23514 -> generic500 + bounded diagnostic collected; transaction rollback verified');
}finally{console.error=original;await client?.dispose();await app?.stop();console.log('Owned diagnostic Web/PostgreSQL/request context stopped.');}
