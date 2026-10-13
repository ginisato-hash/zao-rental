import test from 'node:test';
import assert from 'node:assert/strict';
import {NextRequest} from 'next/server';
import nextConfig from '../../apps/web/next.config';
import {proxy} from '../../apps/web/src/proxy';
import robots from '../../apps/web/src/app/robots';
import {indexablePage,parsePublicationApproval,publicationApproved,publicationDeploymentFactsApproved,publicationEnvironmentApproved,PUBLICATION_ORIGIN,type PublicationDeploymentFacts} from '../../packages/auth/src/publication-authority';
import {EXPECTED_PRODUCTION_DATABASE_NAME,EXPECTED_PRODUCTION_HOST_FINGERPRINT_SHA256,EXPECTED_PRODUCTION_VERCEL_PROJECT_FINGERPRINT_SHA256,productionHostFingerprint,productionVercelProjectFingerprint} from '../../packages/auth/src/production-identity';
import {indexingEnabled,robotsRules} from '../../packages/core/src/content/public-pages';

const release='0123456789abcdef0123456789abcdef01234567',now=new Date('2035-01-01T00:00:00Z');
const approval={state:'PUBLICATION_APPROVED',origin:PUBLICATION_ORIGIN,releaseId:release,approvedBy:'Synthetic Owner',approvedAt:'2034-12-31T23:59:59Z'};
const facts:PublicationDeploymentFacts={environment:'production',vercelProjectFingerprintSha256:EXPECTED_PRODUCTION_VERCEL_PROJECT_FINGERPRINT_SHA256,hostFingerprintSha256:EXPECTED_PRODUCTION_HOST_FINGERPRINT_SHA256,databaseName:EXPECTED_PRODUCTION_DATABASE_NAME,releaseId:release,gitCommitSha:release,origin:PUBLICATION_ORIGIN,approval:JSON.stringify(approval)};
test('Vercel routes/isolates cannot share global memory: pinned publication facts independently approve without an installed capability',()=>{
 assert.equal(publicationApproved(),false);
 for(const gitCommitSha of [undefined,'',release])assert.equal(publicationDeploymentFactsApproved({...facts,gitCommitSha},now),true);
 assert.equal(publicationDeploymentFactsApproved({...facts,approval:JSON.stringify({...approval,approvedAt:now.toISOString(),approvedBy:'x'.repeat(120)})},now),true);
 assert.equal(publicationApproved(),false,'facts validation never installs a runtime capability');
});
const rejectedFacts:[string,Partial<PublicationDeploymentFacts>][]=[
 ['wrong Vercel project fingerprint',{vercelProjectFingerprintSha256:productionVercelProjectFingerprint('synthetic-project')}],
 ['wrong Neon host fingerprint',{hostFingerprintSha256:productionHostFingerprint('ep-synthetic.neon.tech')}],
 ['wrong database',{databaseName:'another_database'}],
 ...[undefined,'','preview','development','Production'].map(environment=>['not Production',{environment}] as [string,Partial<PublicationDeploymentFacts>]),
 ...[undefined,'','main',release.toUpperCase(),release.slice(1),release+'0',' '+release,release+'\n'].map(releaseId=>['missing/malformed release',{releaseId}] as [string,Partial<PublicationDeploymentFacts>]),
 ...['f'.repeat(40),' ',release+' ',release.toUpperCase()].map(gitCommitSha=>['mismatched nonempty Git SHA',{gitCommitSha}] as [string,Partial<PublicationDeploymentFacts>]),
 ['wrong origin',{origin:'https://staged.vercel.app'}],['missing approval',{approval:undefined}],['malformed approval',{approval:'{'}],
 ...[null,true,[],{}, {...approval,extra:true},{...approval,state:'PENDING'},{...approval,releaseId:'f'.repeat(40)},{...approval,releaseId:1},{...approval,origin:'https://other.yuge-zao.com'},{...approval,approvedBy:''},{...approval,approvedBy:'  '},{...approval,approvedBy:'x'.repeat(121)},{...approval,approvedBy:1},{...approval,approvedAt:'2035-01-01T00:00:01Z'},{...approval,approvedAt:'not-a-time'},{...approval,approvedAt:1}].map(a=>['invalid approval '+JSON.stringify(a),{approval:JSON.stringify(a)}] as [string,Partial<PublicationDeploymentFacts>]),
];
for(const [name,patch] of rejectedFacts)test('deterministic publication fails closed: '+name,()=>assert.equal(publicationDeploymentFactsApproved({...facts,...patch},now),false));
test('malformed release is rejected even with a matching approval and no platform Git SHA, including a trailing newline',()=>{
 for(const releaseId of ['', 'main',release.toUpperCase(),release.slice(1),release+'0',' '+release,release+'\n'])assert.equal(publicationDeploymentFactsApproved({...facts,releaseId,gitCommitSha:'',approval:JSON.stringify({...approval,releaseId})},now),false);
});
test('an invalid verification clock cannot approve a deployment',()=>assert.equal(publicationDeploymentFactsApproved(facts,new Date('invalid')),false));
test('shared strict approval parser preserves exact shape, immutable value and fixed value-free errors',()=>{
 assert.equal(parsePublicationApproval(undefined),undefined);
 const a=parsePublicationApproval(JSON.stringify(approval));assert.deepEqual(a,approval);assert.ok(Object.isFrozen(a));
 for(const raw of ['','{','null','[]','true',JSON.stringify({...approval,extra:true}),JSON.stringify({...approval,state:'PENDING'}),JSON.stringify({...approval,origin:'https://staged.vercel.app'}),...['state','origin','releaseId','approvedBy','approvedAt'].map(k=>JSON.stringify(Object.fromEntries(Object.entries(approval).filter(([name])=>name!==k))))])assert.throws(()=>parsePublicationApproval(raw),{message:'PRODUCTION_COMMERCIAL_PUBLICATION_APPROVAL_INVALID'});
 // Parsing retains the original contract: time/binding/blank checks belong to the verifier.
 assert.equal(parsePublicationApproval(JSON.stringify({...approval,approvedBy:' ',approvedAt:'invalid'}))?.approvedBy,' ');
});
test('env adapter hashes real inputs; supplied fingerprints, request-shaped values and legacy flags cannot authorize publication',()=>{
 const synthetic={VERCEL_ENV:'production',VERCEL_PROJECT_ID:'synthetic-project',PRODUCTION_DB_HOST:'ep-synthetic.neon.tech',PRODUCTION_DB_NAME:'neondb',PRODUCTION_RELEASE_ID:release,VERCEL_GIT_COMMIT_SHA:release,PRODUCTION_PUBLIC_ORIGIN:PUBLICATION_ORIGIN,PRODUCTION_PUBLICATION_APPROVAL:JSON.stringify(approval)};
 assert.equal(publicationEnvironmentApproved(synthetic,now),false);
 assert.equal(publicationEnvironmentApproved({...synthetic,VERCEL_PROJECT_ID:EXPECTED_PRODUCTION_VERCEL_PROJECT_FINGERPRINT_SHA256,PRODUCTION_DB_HOST:EXPECTED_PRODUCTION_HOST_FINGERPRINT_SHA256},now),false,'digests cannot be substituted for raw identifiers');
 for(const env of [{},{NODE_ENV:'production'},{PUBLIC:'true'},{PUBLIC_INDEXING:'true'},{ZAO_TEST_PUBLIC_INDEXING:'1'},{VERCEL_URL:'zao-rental.vercel.app'},{Host:'salomon-rental.yuge-zao.com',Forwarded:'host=salomon-rental.yuge-zao.com','X-Forwarded-Host':'salomon-rental.yuge-zao.com',cookie:'PUBLIC=true',query:'PUBLIC=true',body:JSON.stringify(approval)}])assert.equal(publicationEnvironmentApproved(env,now),false);
});

test('Production headers keep security headers but no static page-wide noindex; APIs stay statically noindex',async()=>{
 const old=process.env.NODE_ENV;(process.env as Record<string,string>).NODE_ENV='production';
 try{
  const rules=await nextConfig.headers!(),pages=rules.find(r=>r.source==='/:path*')!,api=rules.find(r=>r.source==='/api/:path*')!;
  assert.ok(!pages.headers.some(h=>h.key.toLowerCase()==='x-robots-tag'));
  for(const key of ['X-Content-Type-Options','Referrer-Policy','X-Frame-Options'])assert.ok(pages.headers.some(h=>h.key===key));
  assert.deepEqual(api.headers.find(h=>h.key==='X-Robots-Tag'),{key:'X-Robots-Tag',value:'noindex, nofollow'});
 }finally{(process.env as Record<string,string|undefined>).NODE_ENV=old;}
});
test('indexing matrix: only authority + exact public origin + allowlisted query-free public path may index',()=>{
 const publicPaths=['/ja','/en/','/ja/rental/ski','/en/prices','/ja/stores/onsen-base','/en/faq','/ja/legal/terms','/en/legal/privacy','/ja/legal/commercial-disclosure','/en/legal/cancellation'];
 const privatePaths=['/ja/legal','/ja/legal/other','/en/legal/terms/x','/ja/legalterms','/staff/login','/admin','/api/health','/api/guest/draft','/ja/book','/ja/booking/abc','/ja/reservation','/preview/avatar','/sitemap.xml','/robots.txt'];
 for(const path of [...publicPaths,...privatePaths])assert.equal(indexablePage(false,PUBLICATION_ORIGIN,path),false,path);
 for(const path of publicPaths)assert.equal(indexablePage(true,PUBLICATION_ORIGIN,path),true,path);
 for(const path of privatePaths)assert.equal(indexablePage(true,PUBLICATION_ORIGIN,path),false,path);
 for(const path of publicPaths)assert.equal(indexablePage(true,PUBLICATION_ORIGIN,path,'?date=2035-01-05'),false,path);
 for(const origin of ['https://zao-rental.vercel.app','http://salomon-rental.yuge-zao.com','https://www.salomon-rental.yuge-zao.com','https://yuge-zao.com','https://other.yuge-zao.com','https://salomon-rental.yuge-zao.com.attacker.example','https://evil-salomon-rental.yuge-zao.com','https://salomonzao.rent'])assert.equal(indexablePage(true,origin,'/ja'),false,origin);
});
test('without installed authority the proxy marks every page noindex, public ones included',()=>{
 assert.equal(publicationApproved(),false);
 for(const url of [PUBLICATION_ORIGIN+'/ja',PUBLICATION_ORIGIN+'/en/rental/ski',PUBLICATION_ORIGIN+'/staff/login',PUBLICATION_ORIGIN+'/ja/rental?people=2','https://zao-rental.vercel.app/ja']){
  const response=proxy(new NextRequest(url));assert.equal(response.headers.get('X-Robots-Tag'),'noindex, nofollow',url);
 }
 const privateResponse=proxy(new NextRequest(PUBLICATION_ORIGIN+'/staff/login'));assert.equal(privateResponse.headers.get('Cache-Control'),'private, no-store');
});
test('robots.txt and page indexing follow the same authority; an env flag alone never enables it',()=>{
 assert.deepEqual(robotsRules(false),{disallow:'/'});
 const open=robotsRules(true);assert.deepEqual(open.allow,['/ja','/en']);for(const p of ['/api/','/staff/','/admin/','/ja/booking/','/*?*'])assert.ok((open.disallow as string[]).includes(p));
 const old=process.env.ZAO_TEST_PUBLIC_INDEXING;
 try{process.env.ZAO_TEST_PUBLIC_INDEXING='1';assert.equal(indexingEnabled(),false);assert.deepEqual(robots().rules,{userAgent:'*',disallow:'/'});}
 finally{if(old===undefined)delete process.env.ZAO_TEST_PUBLIC_INDEXING;else process.env.ZAO_TEST_PUBLIC_INDEXING=old;}
});
