import assert from 'node:assert/strict';
import {test} from 'node:test';
import {pageSchema,publicPage,safeJsonLd} from '../../packages/core/src/content/public-pages';
import {publicMetadata} from '../../apps/web/src/lib/public-seo';
test('released page copy drives structured data; unsafe text cannot break out of JSON-LD',()=>{
 const page={...publicPage('en','rental/snowboard')!,title:'Released snowboard page',summary:'Actual published text </script><script>unsafe</script>'};
 const schema=pageSchema('en',page.path,'https://rental.invalid',page),web=schema.find(s=>s['@type']==='WebPage')!;
 assert.equal(web.name,page.title);assert.equal(web.description,page.summary);assert.equal(web.inLanguage,'en');assert.equal(web.url,'https://rental.invalid/en/rental/snowboard');
 assert.equal(schema.find(s=>s['@type']==='WebSite')!.name,'SALOMON RENTAL STATION ZAO');assert.doesNotMatch(safeJsonLd(schema),/[<>]/);assert.deepEqual(JSON.parse(safeJsonLd(schema)),schema);
});
test('JA/EN descriptions, sharing brand and locale agree without opening indexing gates',()=>{
 for(const locale of ['ja','en']as const){const page=publicPage(locale,'')!,m=publicMetadata(locale,'',page.title,page.summary,true);
  assert.equal(m.title,page.title+' | SALOMON RENTAL STATION ZAO');assert.equal(m.description,page.summary);assert.equal(m.openGraph?.description,page.summary);assert.equal(m.openGraph?.siteName,'SALOMON RENTAL STATION ZAO');assert.equal(m.openGraph?.locale,locale==='ja'?'ja_JP':'en_US');assert.deepEqual(m.robots,{index:false,follow:false});
 }
});
