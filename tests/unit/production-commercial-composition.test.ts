import test from 'node:test';
import assert from 'node:assert/strict';
import {COMMERCIAL_ACTIVATION_TOKEN,COMMERCIAL_ALLOWLISTED_KEYS,COMMERCIAL_DB_SERVICES,COMMERCIAL_FLAGS,commercialGuestConfiguration,commercialProductionPlan,commercialRuntimeInput,commercialSquareRoutes,installProductionCommercialComposition,parseProductionPublicOrigin} from '../../packages/core/src/guest/production-commercial-composition';
import {SQUARE_VERSION,type SquareCall} from '../../packages/core/src/payment/square-engine';
import {installProductionHostingComposition,HOSTING_ACTIVATION_TOKEN} from '../../packages/core/src/guest/production-hosting-composition';
import {productionServices} from '../../packages/auth/src/production-config';
import {guestConfigurationHash} from '../../packages/contracts/src/production-guest';
import {PUBLICATION_ORIGIN,issuePublicationAuthority} from '../../packages/auth/src/publication-authority';
import {productionStartupState} from '../../packages/core/src/guest/production-bootstrap';

// Synthetic values only. The real Vercel project/Neon host are pinned by fingerprint, so a
// fixture proves the pure derivation and every reject path; issueExactProductionIdentity's
// accept path is provable only in the real Production environment (no test issuer exists).
const RELEASE='0123456789abcdef0123456789abcdef01234567',TOKEN='EAAAsyntheticProductionAccessToken0001',RESEND='re_syntheticresendkey0001';
const pw=(s:string)=>'synthetic-password-'+s+'-0001';
function env(patch:Record<string,string|undefined>={}){
 const e:Record<string,string|undefined>={
  ZAO_PRODUCTION_HOSTING_ACTIVATION:COMMERCIAL_ACTIVATION_TOKEN,VERCEL_ENV:'production',VERCEL_PROJECT_ID:'synthetic-project',PRODUCTION_RELEASE_ID:RELEASE,
  PRODUCTION_PUBLIC_ORIGIN:'https://zao-rental-synthetic.vercel.app',PRODUCTION_DB_HOST:'ep-synthetic-fixture.ap-southeast-1.aws.neon.tech',PRODUCTION_DB_NAME:'neondb',
  PRODUCTION_GUEST_POLICY_SHA256:guestConfigurationHash(commercialGuestConfiguration()),
  PRODUCTION_GUEST_KEY:'a'.repeat(64),PRODUCTION_STAFF_KEY:'b'.repeat(64),PRODUCTION_ACCESS_KEY:'c'.repeat(64),PRODUCTION_RECOVERY_KEY:'d'.repeat(64),PRODUCTION_ACCESS_KEY_VERSION:'access-v1',PRODUCTION_RECOVERY_KEY_VERSION:'recovery-v1',
  PRODUCTION_SQUARE_APPLICATION_ID:'sq0idp-syntheticAppId0001',PRODUCTION_SQUARE_MERCHANT_ID:'SYNTHETIC-MERCHANT',PRODUCTION_SQUARE_LOCATION_MOUNTAIN_BASE:'SYNTHETIC-LOC-MOUNTAIN',PRODUCTION_SQUARE_LOCATION_ONSEN_BASE:'SYNTHETIC-LOC-ONSEN',
  PRODUCTION_SQUARE_ACCESS_TOKEN:TOKEN,PRODUCTION_SQUARE_ACCESS_TOKEN_EXPIRES_AT:'2099-01-01T00:00:00Z',PRODUCTION_RESEND_API_KEY:RESEND,
 };
 for(const s of productionServices)e[`PRODUCTION_DB_ROLE_${s.toUpperCase()}`]='neondb_'+s;
 for(const s of COMMERCIAL_DB_SERVICES)e[`PRODUCTION_DB_PASSWORD_${s.toUpperCase()}`]=pw(s);
 return {...e,...patch};
}

test('commercial and dark profiles are mutually exclusive by activation token and default OFF',()=>{
 assert.equal(commercialProductionPlan({}),null);assert.deepEqual(installProductionCommercialComposition({}),{status:'NOT_ACTIVATED'});
 assert.equal(commercialProductionPlan(env({ZAO_PRODUCTION_HOSTING_ACTIVATION:HOSTING_ACTIVATION_TOKEN})),null);
 assert.deepEqual(installProductionHostingComposition(env()),{status:'NOT_ACTIVATED'});
 assert.equal(productionStartupState().stage,'FEATURE_FLAGS');
});
test('pure derivation: explicit flags, explicit origin/release, two Square locations and only the required DB credentials',()=>{
 const p=commercialProductionPlan(env({PRODUCTION_DB_PASSWORD_AVATAR_READ:pw('avatar_read'),UNRELATED_SECRET:'must-never-be-read'}))!;
 assert.deepEqual({...p.configuration.flags},{...COMMERCIAL_FLAGS});assert.equal(p.configuration.media,null);
 assert.deepEqual({...p.configuration.deployment},{provider:'VERCEL',environment:'production',projectId:'synthetic-project',releaseId:RELEASE,origin:'https://zao-rental-synthetic.vercel.app'});
 assert.deepEqual({...p.configuration.payment!.locations},{MOUNTAIN_BASE:'SYNTHETIC-LOC-MOUNTAIN',ONSEN_BASE:'SYNTHETIC-LOC-ONSEN'});
 assert.deepEqual(Object.keys(p.secrets.database).sort(),[...COMMERCIAL_DB_SERVICES].sort());assert.equal(p.secrets.database.avatar_read,undefined);
 for(const s of COMMERCIAL_DB_SERVICES)assert.deepEqual(p.secrets.database[s],{provider:'NEON',environment:'PRODUCTION',host:'ep-synthetic-fixture.ap-southeast-1.aws.neon.tech',port:5432,database:'neondb',user:'neondb_'+s,password:pw(s),revoked:false});
 assert.equal(p.publication,undefined);assert.ok(!JSON.stringify(p).includes('must-never-be-read'));
 assert.ok(!COMMERCIAL_ALLOWLISTED_KEYS.includes('PRODUCTION_DB_PASSWORD_AVATAR_READ'));
});
test('every invalid or ambiguous input fails closed with a value-free code',()=>{
 const cases:Record<string,string|undefined>[]=[
  {VERCEL_ENV:'preview'},{VERCEL_ENV:undefined},{VERCEL_PROJECT_ID:undefined},
  {PRODUCTION_RELEASE_ID:undefined},{PRODUCTION_RELEASE_ID:'main'},{VERCEL_GIT_COMMIT_SHA:'f'.repeat(40)},
  {PRODUCTION_PUBLIC_ORIGIN:undefined},{PRODUCTION_PUBLIC_ORIGIN:'http://salomon-rental.yuge-zao.com'},{PRODUCTION_PUBLIC_ORIGIN:'https://salomon-rental.yuge-zao.com/'},{PRODUCTION_PUBLIC_ORIGIN:'https://salomon-rental.yuge-zao.com:8443'},{PRODUCTION_PUBLIC_ORIGIN:'https://www.salomon-rental.yuge-zao.com'},{PRODUCTION_PUBLIC_ORIGIN:'https://yuge-zao.com'},{PRODUCTION_PUBLIC_ORIGIN:'https://other.yuge-zao.com'},{PRODUCTION_PUBLIC_ORIGIN:'https://salomon-rental.yuge-zao.com.attacker.example'},{PRODUCTION_PUBLIC_ORIGIN:'https://salomonzao.rent'},{PRODUCTION_PUBLIC_ORIGIN:'https://attacker.example'},{PRODUCTION_PUBLIC_ORIGIN:'https://x.vercel.app.attacker.example'},
  {PRODUCTION_DB_HOST:undefined},{PRODUCTION_DB_HOST:'db.example.invalid'},{PRODUCTION_DB_ROLE_GUEST:undefined},{PRODUCTION_DB_ROLE_GUEST:'neondb_owner'},
  {PRODUCTION_DB_PASSWORD_OPERATIONS:undefined},{PRODUCTION_DB_PASSWORD_LEDGER:'short'},
  {PRODUCTION_GUEST_KEY:'not-hex'},{PRODUCTION_RECOVERY_KEY:'a'.repeat(64)},{PRODUCTION_ACCESS_KEY_VERSION:''},
  {PRODUCTION_GUEST_POLICY_SHA256:'0'.repeat(64)},{PRODUCTION_GUEST_POLICY_SHA256:undefined},
  {PRODUCTION_SQUARE_APPLICATION_ID:'sandbox-sq0idb-syntheticAppId0001'},{PRODUCTION_SQUARE_MERCHANT_ID:undefined},
  {PRODUCTION_SQUARE_LOCATION_ONSEN_BASE:undefined},{PRODUCTION_SQUARE_LOCATION_ONSEN_BASE:'SYNTHETIC-LOC-MOUNTAIN'},
  {PRODUCTION_SQUARE_ACCESS_TOKEN:undefined},{PRODUCTION_SQUARE_ACCESS_TOKEN:'short'},{PRODUCTION_SQUARE_ACCESS_TOKEN_EXPIRES_AT:'2000-01-01T00:00:00Z'},{PRODUCTION_SQUARE_ACCESS_TOKEN_EXPIRES_AT:'tomorrow'},
  {PRODUCTION_SQUARE_ACCESS_TOKEN_EXPIRES_AT:undefined},{PRODUCTION_SQUARE_ACCESS_TOKEN_EXPIRES_AT:''},...['NEVER','Never',' never','never ','null','0','none','2099-01-01'].map(v=>({PRODUCTION_SQUARE_ACCESS_TOKEN_EXPIRES_AT:v})),
  {PRODUCTION_SQUARE_WEBHOOK_NOTIFICATION_URL:'https://ingress.example/hook?x=1'},
  {PRODUCTION_RESEND_API_KEY:undefined},{PRODUCTION_RESEND_API_KEY:'sk_synthetic_not_resend_0001'},
  {PRODUCTION_PUBLICATION_APPROVAL:'{"state":"PUBLICATION_APPROVED"}'},{PRODUCTION_PUBLICATION_APPROVAL:'true'},
 ];
 for(const patch of cases){
  let error:unknown;try{commercialProductionPlan(env(patch));}catch(e){error=e;}
  assert.ok(error instanceof Error,JSON.stringify(patch));
  assert.match(error.message,/^[A-Z_]+$/,JSON.stringify(patch));
  for(const secret of [TOKEN,RESEND,'a'.repeat(64),pw('operations')])assert.ok(!error.message.includes(secret));
 }
});
test('release identity: a CLI deployment reports no Git SHA as an empty string (accepted), an equal SHA is accepted, any other non-empty value fails closed',()=>{
 for(const sha of [undefined,'',RELEASE])assert.equal(commercialProductionPlan(env({VERCEL_GIT_COMMIT_SHA:sha}))!.configuration.deployment.releaseId,RELEASE,String(sha));
 for(const sha of ['f'.repeat(40),' ',RELEASE+' ','main',RELEASE.toUpperCase()]){
  assert.throws(()=>commercialProductionPlan(env({VERCEL_GIT_COMMIT_SHA:sha})),/^Error: PRODUCTION_COMMERCIAL_RELEASE_IDENTITY_INVALID$/,JSON.stringify(sha));
 }
 // the release id itself is still required, 40 lowercase hex, whatever the platform reports
 for(const rel of [undefined,'',RELEASE.toUpperCase(),RELEASE.slice(1)])assert.throws(()=>commercialProductionPlan(env({PRODUCTION_RELEASE_ID:rel,VERCEL_GIT_COMMIT_SHA:''})),/RELEASE_IDENTITY_INVALID/,String(rel));
});
test('Square token expiry: exactly "never" is provider-confirmed non-expiring (null); a future UTC timestamp stays a Date',async()=>{
 assert.equal(commercialProductionPlan(env({PRODUCTION_SQUARE_ACCESS_TOKEN_EXPIRES_AT:'never'}))!.square.expiresAt,null);
 assert.equal(commercialProductionPlan(env())!.square.expiresAt!.toISOString(),'2099-01-01T00:00:00.000Z');
 assert.throws(()=>commercialProductionPlan(env({PRODUCTION_SQUARE_ACCESS_TOKEN_EXPIRES_AT:'2035-01-01T00:00:00Z'}),new Date('2035-01-01T00:00:01Z')),{message:'PRODUCTION_COMMERCIAL_SQUARE_CREDENTIAL_EXPIRED'});
 // The non-expiring credential reaches the exact Production transport; nothing else about the binding is relaxed.
 const p=commercialProductionPlan(env({PRODUCTION_SQUARE_ACCESS_TOKEN_EXPIRES_AT:'never'}))!,sent:{url:string;auth:string|null}[]=[];
 const routes=commercialSquareRoutes(p.square,async(url,init)=>{sent.push({url,auth:new Headers(init.headers).get('Authorization')});return Response.json({payment:{id:'x'}});});
 const call:SquareCall={method:'GET',url:'https://connect.squareup.com/v2/payments/synthetic-payment',version:SQUARE_VERSION,signal:new AbortController().signal};
 await routes.MOUNTAIN_BASE.transport.send(call);assert.deepEqual(sent,[{url:call.url,auth:'Bearer '+TOKEN}]);
 for(const e of [{PRODUCTION_SQUARE_LOCATION_ONSEN_BASE:'SYNTHETIC-LOC-MOUNTAIN'},{PRODUCTION_SQUARE_APPLICATION_ID:'sandbox-sq0idb-syntheticAppId0001'},{VERCEL_ENV:'preview'}])assert.throws(()=>commercialProductionPlan(env({...e,PRODUCTION_SQUARE_ACCESS_TOKEN_EXPIRES_AT:'never'})));
});
test('install always runs the real exact-identity gate first; a synthetic project never installs a bootstrap',()=>{
 assert.throws(()=>installProductionCommercialComposition(env()),{message:'PRODUCTION_IDENTITY_WRONG_VERCEL_PROJECT'});
 assert.throws(()=>installProductionCommercialComposition(env()),{message:'PRODUCTION_IDENTITY_WRONG_VERCEL_PROJECT'});
 assert.equal(productionStartupState().stage,'FEATURE_FLAGS');
});
test('runtime input binds routed Square, refund router, Resend and a header-scoped peer without any provider call',async()=>{
 const p=commercialProductionPlan(env())!;let fetches=0;
 const input=commercialRuntimeInput(p,undefined,async()=>{fetches++;throw Error('UNREACHABLE');});
 assert.equal(input.payment!.gateway.kind,'SQUARE_PRODUCTION');assert.equal(input.refunds!.kind,'SQUARE_PRODUCTION');assert.equal(input.payment!.applicationId,'sq0idp-syntheticAppId0001');
 assert.deepEqual(await input.payment!.credentials(),{environment:'PRODUCTION',merchantId:'SYNTHETIC-MERCHANT',token:TOKEN,revoked:false});
 assert.equal(input.notification!.providerId,'RESEND');assert.equal(input.publication,undefined);assert.equal(fetches,0);
 const peer=input.verifiedPeer(new Request('https://zao-rental-synthetic.vercel.app/',{headers:{'x-vercel-forwarded-for':'203.0.113.7','x-forwarded-for':'198.51.100.1','host':'salomon-rental.yuge-zao.com'}}));
 assert.deepEqual(peer,{provider:'VERCEL',environment:'production',projectId:'synthetic-project',releaseId:RELEASE,origin:'https://zao-rental-synthetic.vercel.app',address:'203.0.113.7'});
 for(const headers of [{'x-forwarded-for':'198.51.100.1'},{'x-vercel-forwarded-for':'203.0.113.7, 198.51.100.1'}] as Record<string,string>[])assert.equal(input.verifiedPeer(new Request('https://x.invalid/',{headers})),undefined);
});
test('publication stays a separate explicit approval and is impossible for a non-public origin',()=>{
 const approval={state:'PUBLICATION_APPROVED',origin:PUBLICATION_ORIGIN,releaseId:RELEASE,approvedBy:'Synthetic Owner',approvedAt:'2026-01-01T00:00:00Z'};
 const p=commercialProductionPlan(env({PRODUCTION_PUBLICATION_APPROVAL:JSON.stringify(approval)}))!;assert.deepEqual({...p.publication},approval);
 assert.notEqual(p.configuration.deployment.origin,PUBLICATION_ORIGIN);
 assert.throws(()=>issuePublicationAuthority({kind:'EXACT_PRODUCTION_IDENTITY'},approval as never),{message:'PUBLICATION_APPROVAL_INVALID'});
 assert.equal(parseProductionPublicOrigin(PUBLICATION_ORIGIN),PUBLICATION_ORIGIN);
 assert.equal(commercialProductionPlan(env({PRODUCTION_PUBLIC_ORIGIN:PUBLICATION_ORIGIN}))!.configuration.deployment.origin,PUBLICATION_ORIGIN);
});
