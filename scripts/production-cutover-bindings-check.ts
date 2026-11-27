// Read-only machine reconciliation of the cutover bindings (names/types/targets/timestamps and role posture only; never values).
// Usage: node --import tsx scripts/production-cutover-bindings-check.ts <target> <PRE_SWITCH|POST_SWITCH> <credentialEpochMs>
import {execFile} from 'node:child_process';
import {chmodSync,mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {buildBindingTable,verifyBindings,collectVercelMetadata,MAIN_PROJECT,WEBHOOK_PROJECT,BACKUP_ENVIRONMENT,SOURCE_DATABASE,CUTOVER_TARGETS,type RoleFact,type BindingFacts} from './production-cutover-bindings';
import {productionPorts,BINDINGS_EVIDENCE_FILE,BINDINGS_EVIDENCE_VERSION} from './production-cutover-run';

const gh=(args:string[])=>new Promise<string>((resolve,reject)=>execFile('gh',args,{maxBuffer:8*1024*1024},(e,o)=>e?reject(new Error('CUTOVER_BINDINGS_COLLECT_FAILED')):resolve(String(o))));
async function ghFacts(){
 const repo=JSON.parse(await gh(['repo','view','--json','nameWithOwner'])).nameWithOwner as string;
 const sec=JSON.parse(await gh(['api',`repos/${repo}/environments/${BACKUP_ENVIRONMENT}/secrets`])).secrets as Array<{name:string;updated_at?:string}>;
 const vars=JSON.parse(await gh(['api',`repos/${repo}/environments/${BACKUP_ENVIRONMENT}/variables`])).variables as Array<{name:string}>;
 return{secrets:sec.map(s=>({name:s.name,updatedAt:s.updated_at?Date.parse(s.updated_at):null})),variables:vars.map(v=>v.name)};
}
async function roleFacts(names:string[]):Promise<Record<string,RoleFact|undefined>>{
 const owner=await productionPorts().openOwner(SOURCE_DATABASE);
 try{
  const r=await owner.pool.query(`select r.rolname,r.rolcanlogin,r.rolsuper,r.rolcreatedb,r.rolcreaterole,
   coalesce((select array_agg(g.rolname order by g.rolname) from pg_auth_members m join pg_roles g on g.oid=m.roleid where m.member=r.oid),'{}') as memberships
   from pg_roles r where r.rolname=any($1)`,[names]);
  const out:Record<string,RoleFact|undefined>={};
  for(const n of names)out[n]=undefined;
  for(const x of r.rows)out[x.rolname]={exists:true,login:x.rolcanlogin,superuser:x.rolsuper,createdb:x.rolcreatedb,createrole:x.rolcreaterole,memberships:x.memberships};
  return out;
 }finally{await owner.close();}
}
const [target,stage,epoch]=process.argv.slice(2);
if(!(CUTOVER_TARGETS as readonly string[]).includes(target??'')||(stage!=='PRE_SWITCH'&&stage!=='POST_SWITCH')||!/^\d{10,14}$/.test(epoch??''))throw new Error('CUTOVER_BINDINGS_ARGUMENTS_REJECTED');
const table=buildBindingTable(SOURCE_DATABASE,target);
const [main,webhook,github]=await Promise.all([collectVercelMetadata(MAIN_PROJECT),collectVercelMetadata(WEBHOOK_PROJECT),ghFacts()]);
const roles=await roleFacts(table.roles.map(r=>r.role));
const oldRoles=stage==='POST_SWITCH'?await roleFacts(buildBindingTable(SOURCE_DATABASE,target).roles.map(r=>r.role.replace(target+'_',SOURCE_DATABASE+'_'))):undefined;
const facts:BindingFacts={vercel:{main,webhook},github,roles,...(oldRoles?{oldRoles}:{}),stage,credentialEpoch:Number(epoch)};
const findings=verifyBindings(table,facts);
// Metadata reconciliation evidence for the prewindow-check (PRE_SWITCH only). A metadata match is NOT a live connection/delivery proof: that is production-cutover-live-binding.ts.
if(stage==='PRE_SWITCH'){
 const dir=join(process.cwd(),'.local/evidence/production-cutover');mkdirSync(dir,{recursive:true,mode:0o700});const file=join(dir,BINDINGS_EVIDENCE_FILE);
 writeFileSync(file,JSON.stringify({version:BINDINGS_EVIDENCE_VERSION,target,at:new Date().toISOString(),status:findings.length?'FINDINGS':'CONSISTENT',tableSha256:table.sha256,findings:findings.length}),{mode:0o600});chmodSync(file,0o600);
}
console.log(JSON.stringify({status:findings.length?'FINDINGS':'CONSISTENT',tableSha256:table.sha256,findings}));
process.exit(findings.length?1:0);
