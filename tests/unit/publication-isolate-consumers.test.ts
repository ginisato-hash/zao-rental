import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

function isolated(script:string){
 const result=spawnSync(process.execPath,['--experimental-test-module-mocks','--import','tsx','--input-type=module','-e',script],{encoding:'utf8',env:{PATH:process.env.PATH,NODE_ENV:'production'},timeout:20000});
 assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,'');
}
const setup=`
 import assert from 'node:assert/strict';import {mock} from 'node:test';
 const a=await import('./packages/auth/src/publication-authority.ts');
 const i=await import('./packages/auth/src/production-identity.ts');
 const release='0123456789abcdef0123456789abcdef01234567';
 const approval={state:'PUBLICATION_APPROVED',origin:a.PUBLICATION_ORIGIN,releaseId:release,approvedBy:'Synthetic Owner',approvedAt:'2020-01-01T00:00:00Z'};
 const facts={environment:'production',vercelProjectFingerprintSha256:i.EXPECTED_PRODUCTION_VERCEL_PROJECT_FINGERPRINT_SHA256,hostFingerprintSha256:i.EXPECTED_PRODUCTION_HOST_FINGERPRINT_SHA256,databaseName:i.EXPECTED_PRODUCTION_DATABASE_NAME,releaseId:release,gitCommitSha:release,origin:a.PUBLICATION_ORIGIN,approval:JSON.stringify(approval)};
 assert.equal(a.publicationApproved(),false);
`;
// Consumer unit boundary only: use the real pinned-facts verdict, not a fake hostname,
// fingerprint override or issuer. The raw-env adapter's full accept path still requires the
// real Production host and must be checked after deployment; these tests do not claim it.
for(const approved of [false,true])test('Vercel route/isolate regression: independent consumer process uses publication facts, never shared global memory; approved='+approved,()=>isolated(setup+`
 const verdict=a.publicationDeploymentFactsApproved({...facts,approval:${approved} ? facts.approval : undefined});
 assert.equal(verdict,${approved});
 mock.module(new URL('./packages/auth/src/publication-authority.ts',import.meta.url).href,{namedExports:{...a,publicationApproved:()=>verdict}});
 mock.module(new URL('./apps/web/src/lib/public-content.ts',import.meta.url).href,{namedExports:{publicModels:async()=>[]}});
 const {NextRequest}=await import('next/server');
 const {proxy}=await import('./apps/web/src/proxy.ts');
 const {publicOrigin,indexingEnabled}=await import('./packages/core/src/content/public-pages.ts');
 const {publicMetadata}=await import('./apps/web/src/lib/public-seo.ts');
 const {default:robots}=await import('./apps/web/src/app/robots.ts');
 const {default:sitemap}=await import('./apps/web/src/app/sitemap.ts');
 assert.equal(indexingEnabled(),${approved});
 const origin=${approved} ? a.PUBLICATION_ORIGIN : 'http://127.0.0.1';assert.equal(publicOrigin(undefined),origin);
 const metadata=publicMetadata('ja','prices','Synthetic','Synthetic');
 assert.equal(metadata.metadataBase.origin,origin);assert.equal(metadata.alternates.canonical,'/ja/prices');
 assert.deepEqual(metadata.alternates.languages,{ja:origin+'/ja/prices',en:origin+'/en/prices','x-default':origin+'/ja/prices'});
 assert.equal(metadata.openGraph.url,origin+'/ja/prices');assert.deepEqual(metadata.robots,{index:${approved},follow:${approved}});
 const r=robots();assert.equal(r.sitemap,origin+'/sitemap.xml');
 if(${approved}){assert.deepEqual(r.rules.allow,['/ja','/en']);for(const path of ['/api/','/staff/','/admin/','/ja/book','/en/book','/*?*'])assert.ok(r.rules.disallow.includes(path));}
 else assert.deepEqual(r.rules,{userAgent:'*',disallow:'/'});
 const map=await sitemap();if(${approved}){assert.ok(map.length>0);for(const entry of map){assert.ok(entry.url.startsWith(a.PUBLICATION_ORIGIN+'/'));for(const url of Object.values(entry.alternates.languages))assert.ok(url.startsWith(a.PUBLICATION_ORIGIN+'/'));}}else assert.deepEqual(map,[]);
 for(const path of ['/ja','/en','/ja/prices','/en/legal/terms'])assert.equal(proxy(new NextRequest(a.PUBLICATION_ORIGIN+path)).headers.get('X-Robots-Tag'),${approved} ? null : 'noindex, nofollow');
 for(const origin of ['https://staged.vercel.app','https://yuge-zao.com','https://other.yuge-zao.com','https://www.salomon-rental.yuge-zao.com','https://salomon-rental.yuge-zao.com.attacker.example','http://salomon-rental.yuge-zao.com'])assert.equal(proxy(new NextRequest(origin+'/ja')).headers.get('X-Robots-Tag'),'noindex, nofollow');
 for(const path of ['/ja?x=1','/ja/book','/ja/booking/id','/api/health','/staff','/admin','/preview/avatar'])assert.equal(proxy(new NextRequest(a.PUBLICATION_ORIGIN+path)).headers.get('X-Robots-Tag'),'noindex, nofollow');
 // Request headers never upgrade an unapproved origin.
 assert.equal(proxy(new NextRequest('https://staged.vercel.app/ja',{headers:{host:'salomon-rental.yuge-zao.com',forwarded:'host=salomon-rental.yuge-zao.com','x-forwarded-host':'salomon-rental.yuge-zao.com',cookie:'PUBLIC=true'}})).headers.get('X-Robots-Tag'),'noindex, nofollow');
`));
test('installed WeakMap publication capability remains valid and revocable with the env fallback false',()=>isolated(`
 import assert from 'node:assert/strict';import {mock} from 'node:test';
 const i=await import('./packages/auth/src/production-identity.ts');
 const identity=Object.freeze({kind:'EXACT_PRODUCTION_IDENTITY'}),release='0123456789abcdef0123456789abcdef01234567';
 // Same already-issued-identity lookup double as tests/public/prepare-payment.ts. The real
 // identity issuer is unchanged and still rejects a lookalike; no test issuer is added.
 mock.module(new URL('./packages/auth/src/production-identity.ts',import.meta.url).href,{namedExports:{...i,exactProductionIdentityConfiguration:value=>value===identity?{deployment:{origin:'https://salomon-rental.yuge-zao.com',releaseId:release}}:i.exactProductionIdentityConfiguration(value)}});
 const a=await import('./packages/auth/src/publication-authority.ts');
 const approval={state:'PUBLICATION_APPROVED',origin:a.PUBLICATION_ORIGIN,releaseId:release,approvedBy:'Synthetic Owner',approvedAt:'2020-01-01T00:00:00Z'};
 assert.throws(()=>i.issueExactProductionIdentity({}),/REQUIRES_VALIDATED_CONFIGURATION/);
 assert.throws(()=>a.issuePublicationAuthority({kind:'EXACT_PRODUCTION_IDENTITY'},approval),/PUBLICATION_APPROVAL_INVALID/);
 assert.throws(()=>a.installPublicationAuthority({kind:'PUBLICATION_AUTHORITY'}),/PUBLICATION_AUTHORITY_REQUIRED/);
 assert.equal(a.publicationEnvironmentApproved(process.env),false);assert.equal(a.publicationApproved(),false);
 const capability=a.issuePublicationAuthority(identity,approval);assert.equal(a.publicationApproved(),false);
 a.installPublicationAuthority(capability);assert.equal(a.publicationApproved(),true);
 a.revokePublicationAuthority(capability);assert.equal(a.publicationApproved(),false);
 assert.throws(()=>a.installPublicationAuthority(capability),/PUBLICATION_AUTHORITY_REQUIRED/);
`));
