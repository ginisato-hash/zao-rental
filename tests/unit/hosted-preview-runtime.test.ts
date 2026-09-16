import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
// Execute the real route/startup composition in an isolated process. A pg stub
// stops at the first connection, so these regression tests cannot reach a DB.
const setup=`
 import assert from 'node:assert/strict';
 import {registerHooks} from 'node:module';
 const pg='data:text/javascript,'+encodeURIComponent('export class Pool {constructor(){globalThis.poolCreates=(globalThis.poolCreates??0)+1;}on(){}async connect(){throw Error("synthetic-private-driver-failure");}async end(){}}');
 registerHooks({resolve(s,c,next){if(s==='pg')return {url:pg,shortCircuit:true};return next(s==='server-only'?'next/dist/compiled/server-only/empty.js':s,c);}});
 const {phase6Requested,hostedPreviewRuntime}=await import('./apps/web/src/lib/hosted-preview-runtime.ts');
 const {GET}=await import('./apps/web/src/app/api/guest/[[...record]]/route.ts');
 const {GET:avatarMetadata}=await import('./apps/web/src/app/api/guest/avatar/[draftId]/[revision]/[memberKey]/route.ts');
 const {GET:avatarMedia}=await import('./apps/web/src/app/guest-avatar-media/[draftId]/[revision]/[memberKey]/[visualId]/[hash]/route.ts');
 const {guestAvatarBoundary}=await import('./apps/web/src/lib/guest-avatar-runtime.ts');
 const a=await import('./packages/auth/src/hosted-preview-config.ts');
 const {phase6NeonHostname:host}=await import('./packages/db/src/neon-tls.ts');
 const config={resourceId:a.phase6Resource,hostname:host,database:a.phase6Database,guestKey:'synthetic-key-'.repeat(4),connections:Object.fromEntries(a.phase6Services.map(s=>[s,{host,port:5432,user:a.phase6Role(s),database:a.phase6Database,password:'synthetic-password-'.repeat(3),ssl:{rejectUnauthorized:true}}])),r2:{accountId:a.phase6R2Account,bucket:a.phase6R2Bucket,accessKeyId:'synthetic-key',secretAccessKey:'synthetic-secret',expiresAt:'2099-01-01T00:00:00Z',permission:'OBJECT_READ_ONLY'}};
 const h='zao-rental-avatar-preview-123456789-zao-food-map.vercel.app';
 const request=()=>new Request('https://'+h+'/api/guest/draft',{headers:{host:h,'x-vercel-deployment-url':h,'x-vercel-forwarded-for':'192.0.2.11'}});
`;
function run(script:string){
 const r=spawnSync(process.execPath,['--conditions=react-server','--import','tsx','--input-type=module','-e',setup+script],{encoding:'utf8',env:{PATH:process.env.PATH,NODE_ENV:'production'},timeout:15000});
 assert.equal(r.status,0,r.stderr);assert.equal(r.stdout,'');
}
test('production missing capability never starts hosted or falls back to local Guest/Avatar',()=>run(`
 process.env.ZAO_AVATAR_PHASE6='PROTECTED_PREVIEW_V1';
 process.env.ZAO_DEVELOPMENT_RUNTIME='synthetic-invalid-local-config-must-not-be-parsed';
 for(const value of [undefined,'','   ']){
  if(value===undefined)delete process.env.ZAO_HOSTED_PREVIEW_RUNTIME;else process.env.ZAO_HOSTED_PREVIEW_RUNTIME=value;
  assert.equal(phase6Requested(),false);assert.equal(await hostedPreviewRuntime(),null);
  const r=await GET(request());assert.equal(r.status,503);assert.deepEqual(await r.json(),{error:'GUEST_PREVIEW_UNCONNECTED'});
  assert.equal(await guestAvatarBoundary(request()),null);
 }
 assert.equal(globalThis.poolCreates??0,0);
`));
test('real startup passes platform/config boundary without any VERCEL env and preserves driver secrecy',()=>run(`
 process.env.ZAO_HOSTED_PREVIEW_RUNTIME=JSON.stringify(config);
 const r=await GET(request());assert.equal(r.status,503);
 assert.deepEqual(await r.json(),{error:'GUEST_PREVIEW_UNAVAILABLE',stage:'DB_CONNECT_GUEST'});
 assert.equal(globalThis.poolCreates,1);
 // Failed startup stays failed; no repeated connection or local fallback.
 const again=await GET(request());assert.equal((await again.json()).stage,'DB_CONNECT_GUEST');assert.equal(globalThis.poolCreates,1);
`));
test('explicit Production contradiction rejects before DB construction',()=>run(`
 process.env.ZAO_HOSTED_PREVIEW_RUNTIME=JSON.stringify(config);process.env.VERCEL_ENV='production';
 const r=await GET(request());assert.equal(r.status,503);assert.deepEqual(await r.json(),{error:'GUEST_PREVIEW_UNAVAILABLE',stage:'PLATFORM_CONTRADICTION'});assert.equal(globalThis.poolCreates??0,0);
`));
test('invalid nonempty config reports fixed parse failure without fallback',()=>run(`
 process.env.ZAO_HOSTED_PREVIEW_RUNTIME='synthetic-private-json';
 const r=await GET(request());assert.equal(r.status,503);assert.deepEqual(await r.json(),{error:'GUEST_PREVIEW_UNAVAILABLE',stage:'CONFIG_PARSE'});assert.equal(globalThis.poolCreates??0,0);
`));
test('Guest route rejects mismatched deployment ingress before startup IO',()=>run(`
 process.env.ZAO_HOSTED_PREVIEW_RUNTIME=JSON.stringify(config);const req=request();req.headers.set('x-vercel-deployment-url','synthetic-private-header');
 const r=await GET(req);assert.equal(r.status,503);assert.deepEqual(await r.json(),{error:'GUEST_PREVIEW_UNAVAILABLE',stage:'INGRESS_DEPLOYMENT_HEADER'});assert.equal(globalThis.poolCreates??0,0);
`));
for(const kind of ['metadata','media'])for(const header of ['host','x-vercel-deployment-url'])test('Avatar '+kind+' rejects mismatched '+header+' before startup IO',()=>run(`
 process.env.ZAO_HOSTED_PREVIEW_RUNTIME=JSON.stringify(config);
 const scope='20000000-0000-4000-8000-000000000001/1/person-1';
 const path=${JSON.stringify(kind)}==='media'?'/guest-avatar-media/'+scope+'/20000000-0000-4000-8000-000000000002/'+'a'.repeat(64):'/api/guest/avatar/'+scope;
 const headers=new Headers(request().headers);headers.set(${JSON.stringify(header)},'unexpected.vercel.app');
 const r=await (${JSON.stringify(kind)}==='media'?avatarMedia:avatarMetadata)(new Request('https://'+h+path,{headers}));
 assert.equal(r.status,404);assert.equal(await r.text(),'');assert.equal(globalThis.poolCreates??0,0);
`));
for(const kind of ['metadata','media'])test('Avatar '+kind+' accepts exact ingress before isolated driver failure',()=>run(`
 process.env.ZAO_HOSTED_PREVIEW_RUNTIME=JSON.stringify(config);
 const scope='20000000-0000-4000-8000-000000000001/1/person-1';
 const path=${JSON.stringify(kind)}==='media'?'/guest-avatar-media/'+scope+'/20000000-0000-4000-8000-000000000002/'+'a'.repeat(64):'/api/guest/avatar/'+scope;
 const r=await (${JSON.stringify(kind)}==='media'?avatarMedia:avatarMetadata)(new Request('https://'+h+path,{headers:request().headers}));
 assert.equal(r.status,404);assert.equal(await r.text(),'');assert.equal(globalThis.poolCreates,1);
`));
