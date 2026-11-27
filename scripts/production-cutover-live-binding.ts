// LIVE connection binding proof for the NEW database (read-only): the canonical Neon API hands out a connection whose host/role/database/TLS match the pinned identity, and an
// owner session really opens on the target. This is NOT the metadata reconciliation (production-cutover-bindings-check.ts) and NOT the candidate-delivery proof, which can only
// be given after the runtime roles may log in (inside the window: stage attestation + two check windows on the candidate). Writes fixed-shape, secret-free evidence the
// prewindow-check reads as its own item. Usage: node --import tsx scripts/production-cutover-live-binding.ts <target>
import {chmodSync,mkdirSync,writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {Client,type PoolClient} from 'pg';
import {assertFirstAdminTls} from './lib/first-admin-bootstrap';
import {assertNoTlsOverrides} from './lib/production-owner-session';
import {neonCliPort} from './production-backup-credential';
import {CUTOVER_TARGETS,verifyNewDatabaseConnection} from './production-cutover-bindings';
import {LIVE_BINDING_EVIDENCE_FILE,LIVE_BINDING_EVIDENCE_VERSION} from './production-cutover-run';

const target=process.argv[2]??'';
if(process.argv.length!==3||!(CUTOVER_TARGETS as readonly string[]).includes(target))throw new Error('PRODUCTION_CUTOVER_ARGUMENTS_REJECTED');
assertNoTlsOverrides();
const neon=neonCliPort(join(homedir(),'.npm/_npx/978debf9b3a75271/node_modules/.bin/neon'));
const result=await verifyNewDatabaseConnection(target,{neon,
 connect:async c=>{
  const client=new Client({host:c.host,port:c.port,database:c.database,user:c.user,password:c.password,ssl:{rejectUnauthorized:true},enableChannelBinding:true,connectionTimeoutMillis:15000,application_name:'zao_cutover_live_binding'} as never);
  await client.connect();
  return{query:async sql=>({rows:(await client.query(sql)).rows as Array<Record<string,unknown>>}),
   tlsVerified:()=>{try{assertFirstAdminTls(client as unknown as PoolClient,c.host);return true;}catch{return false;}},
   end:async()=>{await client.end();}};
 }});
const dir=join(process.cwd(),'.local/evidence/production-cutover');mkdirSync(dir,{recursive:true,mode:0o700});
const file=join(dir,LIVE_BINDING_EVIDENCE_FILE);
writeFileSync(file,JSON.stringify({version:LIVE_BINDING_EVIDENCE_VERSION,target,at:new Date().toISOString(),status:result.ok?'PASS':'FAIL',reasons:result.reasons,checks:result.checks}),{mode:0o600});chmodSync(file,0o600);
console.log(JSON.stringify({status:result.ok?'LIVE_BINDING_PASS':'LIVE_BINDING_FAIL',target,reasons:result.reasons,checks:result.checks}));
process.exit(result.ok?0:1);
