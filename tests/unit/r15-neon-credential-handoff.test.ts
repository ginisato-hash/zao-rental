import test from 'node:test';
import assert from 'node:assert/strict';
import type {PoolConfig} from 'pg';
import {withNeonCredential} from '../../tools/acceptance/r15-neon-credential-handoff';

const fakePassword='FAKE_ONLY_Handoff_v2_!@:/%';
const uri=(options:Partial<{scheme:string;user:string;password:string;host:string;port:string;db:string;query:string}>={})=>{
  const v={scheme:'postgres',user:'fake_user',password:encodeURIComponent(fakePassword),
    host:'ep-example.neon.tech',port:'',db:'neondb',query:'sslmode=require',...options};
  return v.scheme+'://'+v.user+':'+v.password+'@'+v.host+v.port+'/'+v.db+'?'+v.query;
};
const safe={status:'READY',hostClassification:'NEON_HOSTED',database:'zr_852b20c4d4b0',ssl:true};
async function run(raw:string,check:(c:PoolConfig)=>void=()=>{}){
  let reads=0,clients=0,closed=0;
  const result=await withNeonCredential({async readRawConnectionString(){reads++;return raw;},async close(){closed++;}},async c=>{
    clients++;assert.equal(closed,0,'source must survive config construction and consume');check(c);
  });
  assert.equal(reads,1);assert.equal(closed,1);return {result,clients};
}
for(const scheme of ['postgres','postgresql'])test('raw '+scheme+' scheme',async()=>{
  assert.deepEqual((await run(uri({scheme,db:'db'}))).result,safe);
});
test('additional provider query parameters and channel binding',async()=>{
  const r=await run(uri({query:'sslmode=require&channel_binding=require&connect_timeout=10&application_name=provider'}),c=>{
    assert.equal(c.enableChannelBinding,true);assert.deepEqual(c.ssl,{rejectUnauthorized:true});
  });assert.deepEqual(r.result,safe);
});
test('percent encoded username password and database use URL semantics',async()=>{
  const r=await run(uri({user:'fake%40owner',db:'source%2Fname'}),c=>{
    assert.equal(c.user,'fake@owner');assert.equal(c.password,fakePassword);
    assert.equal(c.database,'zr_852b20c4d4b0');
  });assert.deepEqual(r.result,safe);
});
test('explicit default port',async()=>{assert.deepEqual((await run(uri({port:':5432'}),c=>assert.equal(c.port,5432))).result,safe);});
test('implicit default port and source neondb target override',async()=>{
  assert.deepEqual((await run(uri(),c=>{assert.equal(c.port,5432);assert.equal(c.database,'zr_852b20c4d4b0');assert.equal(c.connectionString,undefined);})).result,safe);
});
for(const [name,raw] of [
  ['localhost',uri({host:'localhost'})],['IPv4 loopback',uri({host:'127.0.0.1'})],['IPv6 loopback',uri({host:'[::1]'})],
  ['non Neon host',uri({host:'example.com'})],['Neon lookalike suffix',uri({host:'ep-example.neon.tech.attacker.test'})],
  ['missing username',uri({user:''})],['missing password',uri({password:''})],['malformed URI','FAKE_ONLY_NOT_A_URI'],
  ['wrong scheme',uri({scheme:'https'})],['malformed encoding',uri({password:'%xx'})],['bad port',uri({port:':70000'})],
  ['rendered shell snippet','psql "'+uri()+'"'],['multiline URI',uri()+'\n'],['disabled TLS',uri({query:'sslmode=disable'})],
  ['masked password',uri({password:'*****'})],['query cannot replace missing password',uri({password:'',query:'password=FAKE_QUERY'})],
] as const)test('reject '+name+' without DB client construction',async()=>{
  const r=await run(raw);assert.deepEqual(r.result,{status:'BLOCKED_CREDENTIAL_HANDOFF_V2',classification:'CONNECTION_REJECTED'});assert.equal(r.clients,0);
});
test('success returns safe metadata only',async()=>{
  const {result}=await run(uri());assert.deepEqual(result,safe);
  assert.equal(JSON.stringify(result).includes(fakePassword),false);assert.equal('password' in result,false);
});
test('source error message stack and cause never escape; no client creation',async()=>{
  let clients=0,closed=0;
  const error=new Error(fakePassword,{cause:new Error(fakePassword)});
  const result=await withNeonCredential({async readRawConnectionString(){throw error;},async close(){closed++;}},async()=>{clients++;});
  assert.deepEqual(result,{status:'BLOCKED_CREDENTIAL_HANDOFF_V2',classification:'RAW_FIELD_UNAVAILABLE'});
  assert.equal(clients,0);assert.equal(closed,1);assert.equal(JSON.stringify(result).includes(fakePassword),false);
  for(const key of ['message','stack','cause'])assert.equal(key in result,false);
});
test('consumer failure suppressed and credential config references cleared before source closes',async()=>{
  let captured:PoolConfig|undefined;
  const result=await withNeonCredential({async readRawConnectionString(){return uri();},async close(){assert.equal(captured?.password,undefined);}},async c=>{
    captured=c;throw new Error(fakePassword,{cause:new Error(uri())});
  });assert.deepEqual(result,{status:'BLOCKED_CREDENTIAL_HANDOFF_V2',classification:'CONSUMER_FAILED'});
});
test('source close failure is fixed classification only',async()=>{
  const result=await withNeonCredential({async readRawConnectionString(){return uri();},async close(){throw new Error(fakePassword);}},async()=>{});
  assert.deepEqual(result,{status:'BLOCKED_CREDENTIAL_HANDOFF_V2',classification:'SOURCE_CLOSE_FAILED'});
});
test('success and failure emit no stdout or stderr',async()=>{
  const stdout=process.stdout.write,stderr=process.stderr.write;const output:string[]=[];
  const capture:typeof process.stdout.write=(chunk)=>{output.push(String(chunk));return true;};
  try {process.stdout.write=capture;process.stderr.write=capture;
    await run(uri());await run(uri({password:'%xx'}));
    await withNeonCredential({async readRawConnectionString(){throw new Error(fakePassword);},async close(){}},async()=>{});
  }finally{process.stdout.write=stdout;process.stderr.write=stderr;}
  assert.deepEqual(output,[]);
});
