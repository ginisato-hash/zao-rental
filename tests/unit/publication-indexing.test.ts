import test from 'node:test';
import assert from 'node:assert/strict';
import {NextRequest} from 'next/server';
import nextConfig from '../../apps/web/next.config';
import {proxy} from '../../apps/web/src/proxy';
import robots from '../../apps/web/src/app/robots';
import {indexablePage,publicationApproved,PUBLICATION_ORIGIN} from '../../packages/auth/src/publication-authority';
import {indexingEnabled,robotsRules} from '../../packages/core/src/content/public-pages';

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
 const publicPaths=['/ja','/en/','/ja/rental/ski','/en/prices','/ja/stores/onsen-base','/en/faq'];
 const privatePaths=['/staff/login','/admin','/api/health','/api/guest/draft','/ja/book','/ja/booking/abc','/ja/reservation','/preview/avatar','/sitemap.xml','/robots.txt'];
 for(const path of [...publicPaths,...privatePaths])assert.equal(indexablePage(false,PUBLICATION_ORIGIN,path),false,path);
 for(const path of publicPaths)assert.equal(indexablePage(true,PUBLICATION_ORIGIN,path),true,path);
 for(const path of privatePaths)assert.equal(indexablePage(true,PUBLICATION_ORIGIN,path),false,path);
 for(const path of publicPaths)assert.equal(indexablePage(true,PUBLICATION_ORIGIN,path,'?date=2035-01-05'),false,path);
 for(const origin of ['https://zao-rental.vercel.app','http://salomonzao.rent','https://www.salomonzao.rent'])assert.equal(indexablePage(true,origin,'/ja'),false,origin);
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
