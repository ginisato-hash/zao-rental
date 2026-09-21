import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHostedPreview,assertNoHostedPlatformContradiction,hostedPreviewRequestOrigin,phase6Requested,HostedPreviewBoundaryError,phase6Services,phase6Role,phase6Database,phase6Resource,hostedPreviewBranch,phase6Project} from '../../packages/auth/src/hosted-preview-config';
import {vercelPreviewPeer} from '../../packages/core/src/guest/vercel-preview-peer';
import {avatarGuestPolicy} from '../../packages/core/src/avatar/guest-rate';
import guestPolicy from '../../config/production/guest.p4-approved-policy.json';
import {phase6NeonHostname} from '../../packages/db/src/neon-tls';
import {phase6R2Account,phase6R2Bucket} from '../../packages/auth/src/hosted-preview-config';
const env={VERCEL:'1',VERCEL_ENV:'preview',VERCEL_TARGET_ENV:'preview',ZAO_AVATAR_PHASE6:'PROTECTED_PREVIEW_V1',VERCEL_PROJECT_ID:phase6Project,VERCEL_GIT_COMMIT_REF:hostedPreviewBranch,VERCEL_URL:'zao-rental-avatar-preview-123456789-zao-food-map.vercel.app'};
const host=phase6NeonHostname;
const config=()=>({resourceId:phase6Resource,hostname:host,database:phase6Database,guestKey:'synthetic-key-'.repeat(4),connections:Object.fromEntries(phase6Services.map(s=>[s,{host,port:5432,user:phase6Role(s),database:phase6Database,password:'synthetic-password-'.repeat(3),ssl:{rejectUnauthorized:true}}])),r2:{accountId:phase6R2Account,bucket:phase6R2Bucket,accessKeyId:'synthetic-key',secretAccessKey:'synthetic-secret',expiresAt:'2099-01-01T00:00:00Z',permission:'OBJECT_READ_ONLY'}});
test('capability parses and startup guard accepts with every platform binding absent',()=>{
 const absent=Object.fromEntries(Object.keys(env).map(k=>[k,undefined]));
 assertNoHostedPlatformContradiction({...absent,NODE_ENV:'production'});
 assert.equal(parseHostedPreview(JSON.stringify(config())).database,phase6Database);
 assert.equal(phase6Requested({...absent,ZAO_HOSTED_PREVIEW_RUNTIME:JSON.stringify(config())}),true);
});
for(const [key,value]of Object.entries({VERCEL:'0',VERCEL_ENV:'production',VERCEL_TARGET_ENV:'production',VERCEL_PROJECT_ID:'other',VERCEL_GIT_COMMIT_REF:'main'}))test('explicit platform contradiction rejects '+key,()=>{
 assert.throws(()=>assertNoHostedPlatformContradiction({...env,[key]:value}),e=>e instanceof HostedPreviewBoundaryError&&e.stage==='PLATFORM_CONTRADICTION');
});
for(const key of Object.keys(env))test('absent platform binding '+key+' is not authorization failure',()=>{assertNoHostedPlatformContradiction({...env,[key]:undefined});});
test('empty git ref is allowed but whitespace and other branches are contradictions',()=>{
 for(const ref of [undefined,'',hostedPreviewBranch])assertNoHostedPlatformContradiction({...env,VERCEL_GIT_COMMIT_REF:ref});
 for(const ref of ['main',' ','codex/avatar-phase6-hosted-preview',hostedPreviewBranch+'-other'])assert.throws(()=>assertNoHostedPlatformContradiction({...env,VERCEL_GIT_COMMIT_REF:ref}));
 for(const key of ['VERCEL','VERCEL_ENV','VERCEL_TARGET_ENV','VERCEL_PROJECT_ID'])assert.throws(()=>assertNoHostedPlatformContradiction({...env,[key]:''}));
});
test('legacy marker and platform URL neither authorize nor veto startup',()=>{
 assertNoHostedPlatformContradiction({...env,ZAO_AVATAR_PHASE6:'ignored',VERCEL_URL:'ignored.invalid'});
 for(const raw of [undefined,'','   '])assert.equal(phase6Requested({...env,ZAO_HOSTED_PREVIEW_RUNTIME:raw}),false);
 assert.equal(phase6Requested({ZAO_HOSTED_PREVIEW_RUNTIME:'{}'}),true); // malformed non-empty config must fail during startup, never fall back
});
for(const field of ['host','database','role','tls','owner','extra','r2-write','expiry','resource','guestKey'])test('hosted config rejects '+field,()=>{const c=config();if(field==='host')c.connections.guest!.host='127.0.0.1';if(field==='database')c.database='neondb';if(field==='role')c.connections.avatar_read!.user=phase6Role('content_read');if(field==='tls')c.connections.guest!.ssl.rejectUnauthorized=false;if(field==='owner')c.connections.guest!.user='neondb_owner';if(field==='extra')Object.assign(c.connections,{owner:c.connections.guest});if(field==='r2-write')c.r2.permission='OBJECT_READ_WRITE';if(field==='expiry')c.r2.expiresAt='2000-01-01';if(field==='resource')c.resourceId='another';if(field==='guestKey')c.guestKey='short';assert.throws(()=>parseHostedPreview(JSON.stringify(c)));});
const request=(headers:Record<string,string>={})=>new Request('https://'+env.VERCEL_URL+'/api/guest/draft',{headers:{host:env.VERCEL_URL,'x-vercel-deployment-url':env.VERCEL_URL,'x-vercel-forwarded-for':'192.0.2.11',...headers}});
test('peer ignores arbitrary generic forwarded/client headers; canonical mapped IPv6 shares budget',()=>{const key='k'.repeat(32),a=vercelPreviewPeer(request(),key);assert.match(a,/^[a-f0-9]{64}$/);assert.equal(vercelPreviewPeer(request({'x-forwarded-for':'203.0.113.4','forwarded':'for=203.0.113.5','x-real-ip':'203.0.113.6'}),key),a);assert.equal(vercelPreviewPeer(request({'x-vercel-forwarded-for':'::ffff:192.0.2.11'}),key),a);});
for(const peer of ['', '192.0.2.1,192.0.2.2','arbitrary','fe80::1%en0'])test('ingress rejects missing/malformed/chain '+peer,()=>{assert.throws(()=>vercelPreviewPeer(request({'x-vercel-forwarded-for':peer}),'k'.repeat(32)));});
test('ingress accepts only matching immutable Preview request identity',()=>{
 assert.equal(hostedPreviewRequestOrigin(request()),'https://'+env.VERCEL_URL);
 for(const [url,headers,stage]of [
  ['http://'+env.VERCEL_URL,{},'INGRESS_SCHEME'],
  ['https://'+env.VERCEL_URL,{host:'wrong.invalid'},'INGRESS_HOST'],
  ['https://'+env.VERCEL_URL,{'x-vercel-deployment-url':'other.invalid'},'INGRESS_DEPLOYMENT_HEADER'],
  ['https://zao-rental-avatar-preview-zao-food-map.vercel.app',{},'INGRESS_HOST_PATTERN'],
  ['https://zao-rental-123456789-zao-food-map.vercel.app',{},'INGRESS_HOST_PATTERN'],
  ['https://'+env.VERCEL_URL+':8443',{},'INGRESS_HOST_PATTERN'],
 ]as const){const host=new URL(url).host,r=new Request(url+'/api/guest/draft',{headers:{host,'x-vercel-deployment-url':host,...headers}});assert.throws(()=>hostedPreviewRequestOrigin(r),e=>e instanceof HostedPreviewBoundaryError&&e.stage===stage);}
 for(const key of ['host','x-vercel-deployment-url']){const r=request();r.headers.delete(key);assert.throws(()=>hostedPreviewRequestOrigin(r));}
});
test('generic forwarded spoof cannot replace the required Vercel peer',()=>{
 const r=request({'x-forwarded-for':'192.0.2.11',forwarded:'for=192.0.2.11','x-real-ip':'192.0.2.11'});r.headers.delete('x-vercel-forwarded-for');
 assert.throws(()=>vercelPreviewPeer(r,'k'.repeat(32)),e=>e instanceof HostedPreviewBoundaryError&&e.stage==='INGRESS_PEER');
});
test('Avatar budget is purpose-separated; approved business values unchanged',()=>{assert.equal(guestPolicy.policy.peerRequests,180);assert.equal(guestPolicy.policy.globalRequests,1200);assert.notEqual(avatarGuestPolicy.version,guestPolicy.policy.version);assert.equal(avatarGuestPolicy.peerRequests,240);assert.equal(avatarGuestPolicy.globalRequests,1200);});

test('dedicated runtime denies unrelated custom and payment configuration even if blank',()=>{for(const key of ['PAYMENT_KEY','REFUND_KEY','WEBHOOK_SECRET','ZAO_UNKNOWN'])assert.throws(()=>assertNoHostedPlatformContradiction({...env,[key]:''}));});
test('R2 scope is pinned to the dedicated account and bucket',()=>{for(const field of ['accountId','bucket']as const){const c=config();c.r2[field]=field==='accountId'?'b'.repeat(32):'unrelated-bucket';assert.throws(()=>parseHostedPreview(JSON.stringify(c)));}});
test('historical project identity is an explicit contradiction',()=>{assert.throws(()=>assertNoHostedPlatformContradiction({...env,VERCEL_PROJECT_ID:'prj_ehUMOzM77em9DVnHJBJffncD5hg7'}));});
for(const raw of [undefined,'','  '])test('missing capability reports CONFIG_MISSING '+JSON.stringify(raw),()=>{assert.throws(()=>parseHostedPreview(raw),e=>e instanceof HostedPreviewBoundaryError&&e.stage==='CONFIG_MISSING');});
for(const raw of ['{','null','[]','{}'])test('invalid capability shape reports CONFIG_PARSE '+raw,()=>{assert.throws(()=>parseHostedPreview(raw),e=>e instanceof HostedPreviewBoundaryError&&e.stage==='CONFIG_PARSE');});
for(const service of phase6Services)test('exact role is enforced for '+service,()=>{for(const user of ['postgres','neondb_owner','admin',phase6Role(service)+'_admin']){const c=config();c.connections[service]!.user=user;assert.throws(()=>parseHostedPreview(JSON.stringify(c)));}});
test('R2 credentials require non-empty strings and an actual expiry string',()=>{for(const change of [{accessKeyId:{}},{secretAccessKey:123},{secretAccessKey:' '},{expiresAt:Date.now()+3600000},{expiresAt:'not-a-date'}]){const c=config();Object.assign(c.r2,change);assert.throws(()=>parseHostedPreview(JSON.stringify(c)));}});
test('every forbidden env key is denied even when undefined',()=>{for(const key of ['SQUARE_X','PAYMENT_X','REFUND_X','WEBHOOK_X','DATABASE_URL','POSTGRES_URL','PGPASSWORD','ZAO_X'])assert.throws(()=>assertNoHostedPlatformContradiction({[key]:undefined}),e=>e instanceof HostedPreviewBoundaryError&&e.stage==='CONFIG_FORBIDDEN');});
