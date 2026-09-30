import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes} from 'node:crypto';
import {chmodSync,mkdirSync,mkdtempSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import type {PoolClient} from 'pg';
import {assertFirstAdminRelease,assertFirstAdminTls,firstAdminDatabaseConfig,firstAdminInput,firstAdminSafeError,readFirstAdminInput} from '../../scripts/lib/first-admin-bootstrap';

const value=()=>({email:'SYNTHETIC-OWNER@example.invalid',displayName:'Synthetic Owner',password:randomBytes(24).toString('base64url')});
test('exact three-field schema uses canonical account validation and cannot override authority',()=>{
 const v=value();assert.deepEqual(firstAdminInput(v),v);
 for(const bad of [null,[],{}, {...v,role:'ADMIN'},{...v,permissions:{PRICE_EDIT:true}},{...v,password:'short'},{...v,password:'x'.repeat(129)},{...v,email:'invalid'},{...v,displayName:' '},{...v,displayName:v.password}])assert.throws(()=>firstAdminInput(bad),/INPUT_REJECTED/);
});
test('secure input reads only an owned bounded 0600 regular file outside the repository',()=>{
 const temp=mkdtempSync(join(tmpdir(),'zao-first-admin-')),repository=join(temp,'repo'),file=join(temp,'input.json'),v=value();mkdirSync(repository);
 try{
  writeFileSync(file,JSON.stringify(v),{mode:0o600});assert.deepEqual(readFirstAdminInput(file,repository),v);
  for(const mode of [0o644,0o400,0o700,0o1600]){chmodSync(file,mode);assert.throws(()=>readFirstAdminInput(file,repository),/SECURE_INPUT_REQUIRED/);}chmodSync(file,0o600);
  const inside=join(repository,'input.json');writeFileSync(inside,JSON.stringify(v),{mode:0o600});assert.throws(()=>readFirstAdminInput(inside,repository),/SECURE_INPUT_REQUIRED/);
  const link=join(temp,'link');symlinkSync(file,link);assert.throws(()=>readFirstAdminInput(link,repository),/SECURE_INPUT_REQUIRED/);
  assert.throws(()=>readFirstAdminInput('relative.json',repository),/SECURE_INPUT_REQUIRED/);
  assert.throws(()=>readFirstAdminInput(temp,repository),/SECURE_INPUT_REQUIRED/);
  for(const body of ['', ' '.repeat(16385), '{"password":',JSON.stringify({...v,extra:true})]){writeFileSync(file,body);assert.throws(()=>readFirstAdminInput(file,repository),/SECURE_INPUT_REQUIRED|INPUT_REJECTED/);}
 }finally{rmSync(temp,{recursive:true,force:true});}
});
test('release admission refuses dirty, unmerged, malformed and foreign-repository code',()=>{
 const facts={origin:'https://github.com/ginisato-hash/zao-rental.git',head:'a'.repeat(40),main:'a'.repeat(40),clean:true};assertFirstAdminRelease(facts);
 for(const patch of [{clean:false},{main:'b'.repeat(40)},{head:'a'},{origin:'https://github.com/other/zao-rental.git'}])assert.throws(()=>assertFirstAdminRelease({...facts,...patch}),/RELEASE_REJECTED/);
});
test('fixed Production URI and real TLS admission have no synthetic fallback',()=>{
 for(const uri of [undefined,'invalid','postgresql://neondb_owner:synthetic-password@127.0.0.1/neondb?sslmode=verify-full','postgresql://neondb_owner:synthetic-password@another.neon.tech/neondb?sslmode=verify-full'])assert.throws(()=>firstAdminDatabaseConfig(uri),/DATABASE_REJECTED/);
 for(const stream of [undefined,{encrypted:true,authorized:true,servername:'synthetic'}])assert.throws(()=>assertFirstAdminTls({connection:{stream}} as unknown as PoolClient,'synthetic'),/TLS_REJECTED/);
});
test('CLI requires an explicit secure-file invocation and never echoes arguments or credentials',()=>{
 const secret=randomBytes(32).toString('base64url');
 for(const args of [[],['--email','synthetic@example.invalid','--password',secret],['--input','/unused','extra']]){
  const result=spawnSync(process.execPath,['--import','tsx','scripts/production-bootstrap-first-admin.ts',...args],{encoding:'utf8',env:{...process.env,PRODUCTION_STAFF_BOOTSTRAP_DATABASE_URL:secret}});
  assert.equal(result.status,1);assert.equal(result.stdout,'');assert.deepEqual(JSON.parse(result.stderr),{status:'STOP',code:'PRODUCTION_STAFF_BOOTSTRAP_ARGUMENTS_REJECTED'});
  assert.ok(!(result.stdout+result.stderr).includes(secret));
 }
 assert.equal(firstAdminSafeError(new Error('database error '+secret)),'PRODUCTION_STAFF_BOOTSTRAP_OPERATION_FAILED');
 assert.equal(firstAdminSafeError(new Error('PRODUCTION_STAFF_BOOTSTRAP_'+secret)),'PRODUCTION_STAFF_BOOTSTRAP_OPERATION_FAILED');
});
