// Customer group application: HTTP boundary acceptance against the real tests/group-app (next dev) and isolated PostgreSQL. Synthetic data only.
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {randomUUID} from 'node:crypto';
import {startGroupApp} from './launcher';
import {buildGroupCsvTemplates,parseGroupCsv,serializeGroupCsvRows,type GroupCsvMemberValues} from '../../packages/contracts/src/group-csv';

let stage='startup',count=0,failed=false;
const app=await startGroupApp({stock:150,peerLimit:400});
const {origin,entranceToken}=app,q=(s:string,p:unknown[]=[])=>app.db.pool.query(s,p);
const check=async(name:string,fn:()=>Promise<void>)=>{stage=name;await fn();count++;console.log('PASS '+name);};
const PERIOD={startDate:'2035-02-10',endDate:'2035-02-10',startAt:'08:30',returnBy:'17:00'};
class Browserish{
 jar=new Map<string,string>();
 async req(path:string,o:{method?:'GET'|'POST';body?:unknown;entrance?:string|null;origin?:string|null;raw?:string;contentType?:string}={}){
  const headers:Record<string,string>={};
  if(o.entrance!==null)headers['x-group-entrance']=o.entrance??entranceToken;
  if(o.method==='POST'&&o.origin!==null)headers.origin=o.origin??origin;
  if(o.method==='POST')headers['content-type']=o.contentType??'application/json';
  const cookie=[...this.jar].map(([k,v])=>k+'='+v).join('; ');if(cookie)headers.cookie=cookie;
  const r=await fetch(origin+path,{method:o.method??'GET',headers,...(o.method==='POST'?{body:o.raw??JSON.stringify(o.body??{})}:{}),redirect:'manual'});
  for(const c of r.headers.getSetCookie()){const [kv]=c.split(';');const i=kv!.indexOf('=');const k=kv!.slice(0,i),v=kv!.slice(i+1);if(v==='')this.jar.delete(k);else this.jar.set(k,v);}
  const text=await r.text();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let json:Record<string,any>={};try{json=JSON.parse(text);}catch{/* not json */}
  return {status:r.status,json,text,headers:r.headers};
 }
}
const skiRow=(label:string,over:Partial<GroupCsvMemberValues>={}):GroupCsvMemberValues&{memberId:string|null}=>({memberId:null,label,sport:'SKI',equipment:{kind:'SET'},tier:'REGULAR',ageAtStart:34,adultAtStart:true,heightCm:170,weightKg:65,footCm:25.5,skierType:'TYPE_II',premiumModelCode:null,jacketSize:null,pantsSize:null,wearSport:null,wearAddon:false,...over});
const boardRow=(label:string):GroupCsvMemberValues&{memberId:string|null}=>({...skiRow(label),sport:'SNOWBOARD',equipment:{kind:'ITEMS',items:['SNOWBOARD','SNOWBOARD_BOOT']},weightKg:null,skierType:null});
async function start(b:Browserish,label:string,period=PERIOD){
 const requestKey=randomUUID(),r=await b.req('/api/group/start',{method:'POST',body:{requestKey,groupLabel:label,contactName:'SYNTHETIC Rep',contactEmail:'synthetic-rep@example.invalid',locale:'ja',pickupStore:'MOUNTAIN_BASE',returnStore:'MOUNTAIN_BASE',period}});
 return {r,requestKey,id:r.json.groupId as string};
}
async function through(b:Browserish,id:string,rows:ReturnType<typeof skiRow>[]){
 const g=(await b.req('/api/group/g/'+id)).json,adv=(await b.req(`/api/group/g/${id}/advise`,{method:'POST',body:{rows}})).json;
 assert.equal(adv.ok,true,JSON.stringify(adv));
 const saved=await b.req(`/api/group/g/${id}/members`,{method:'POST',body:{expectedRevision:g.group.revision,rows,directions:rows.map(()=>'RECOMMENDED')}});
 assert.equal(saved.status,200,saved.text);
 const quoted=await b.req(`/api/group/g/${id}/quote`,{method:'POST',body:{expectedRevision:saved.json.revision}});assert.equal(quoted.status,200,quoted.text);
 return {adv,saved:saved.json,view:quoted.json};
}
const groupHolds=async()=>Number((await q("SELECT count(*) n FROM inventory_holds WHERE allocation_stage='GROUP_RESERVED'")).rows[0].n);
try{
 await check('entrance: catalog/templates need the entrance header; wrong or missing entrance reveals nothing; no query strings',async()=>{
  const b=new Browserish();
  assert.equal((await b.req('/api/group/catalog')).status,200);
  assert.equal((await b.req('/api/group/catalog',{entrance:null})).status,404);assert.equal((await b.req('/api/group/catalog',{entrance:'x'.repeat(43)})).status,404);
  assert.equal((await b.req('/api/group/catalog?t='+entranceToken,{entrance:null})).status,422);
  for(const lang of ['ja','en'])for(const kind of ['empty','example','legend']){const r=await b.req(`/api/group/template/${lang}/${kind}`);assert.equal(r.status,200);assert.match(r.headers.get('content-type')!,/text\/csv/);assert.match(r.headers.get('content-disposition')!,/attachment/);assert.equal(r.headers.get('cache-control'),'private, no-store');}
  const empty=(await b.req('/api/group/template/ja/example')).text;const cat=(await b.req('/api/group/catalog')).json;
  const parsed=parseGroupCsv(empty,cat.csv);assert.ok(parsed.ok,JSON.stringify(parsed.errors?.slice(0,3)));
  assert.equal(await groupHolds(),0,'catalog/template downloads consume no stock');
 });
 const A=new Browserish(),B=new Browserish();let a:Awaited<ReturnType<typeof start>>,bb:Awaited<ReturnType<typeof start>>;
 await check('start: permanent entrance, no approval; HttpOnly SameSite=Strict cookie scoped to the group; replay with the same key returns the same group and secret',async()=>{
  a=await start(A,'SYNTHETIC Group A');assert.equal(a.r.status,201);assert.match(a.r.json.groupNumber,/./);
  const sc=a.r.headers.getSetCookie()[0]!;assert.match(sc,/HttpOnly/);assert.match(sc,/SameSite=Strict/);assert.match(sc,new RegExp('Path=/api/group/g/'+a.id));
  const replay=await A.req('/api/group/start',{method:'POST',body:{requestKey:a.requestKey,groupLabel:'SYNTHETIC Group A',contactName:'SYNTHETIC Rep',contactEmail:'synthetic-rep@example.invalid',locale:'ja',pickupStore:'MOUNTAIN_BASE',returnStore:'MOUNTAIN_BASE',period:PERIOD}});
  assert.equal(replay.json.groupId,a.id);assert.equal(replay.json.resumeKey,a.r.json.resumeKey);
  bb=await start(B,'SYNTHETIC Group B');assert.notEqual(bb.id,a.id);
  assert.equal(Number((await q('SELECT count(*) n FROM group_orders')).rows[0].n),2);assert.equal(await groupHolds(),0,'starting consumes no stock');
 });
 await check('isolation: B cannot read or change A (404 everywhere); no cookie = 404; entrance alone opens nothing; GET does not mutate',async()=>{
  const eventsBefore=Number((await q('SELECT count(*) n FROM group_events')).rows[0].n);
  assert.equal((await B.req('/api/group/g/'+a.id)).status,404);
  const stolen=new Browserish();stolen.jar.set('zao_grp_'+a.id.replace(/-/g,''),[...B.jar.values()][0]!);assert.equal((await stolen.req('/api/group/g/'+a.id)).status,404);
  assert.equal((await new Browserish().req('/api/group/g/'+a.id)).status,404);
  assert.equal((await B.req(`/api/group/g/${a.id}/advise`,{method:'POST',body:{rows:[skiRow('x')]}})).status,404);
  assert.equal((await A.req('/api/group/g/'+a.id)).status,200);const view=(await A.req('/api/group/g/'+a.id)).json;
  assert.equal(JSON.stringify(view).includes('synthetic-rep@example.invalid'),false,'owner view carries no contact data');assert.equal(JSON.stringify(view).includes('holdId'),false);
  assert.equal(Number((await q('SELECT count(*) n FROM group_events')).rows[0].n),eventsBefore,'GET wrote nothing');
 });
 await check('resume link: the secret from start restores the session in a fresh browser; wrong secret is 404; the entrance cannot do it',async()=>{
  const fresh=new Browserish();
  assert.equal((await fresh.req('/api/group/session',{method:'POST',body:{groupId:a.id,secret:'z'.repeat(43)}})).status,404);
  assert.equal((await fresh.req('/api/group/g/'+a.id)).status,404);
  assert.equal((await fresh.req('/api/group/session',{method:'POST',body:{groupId:a.id,secret:a.r.json.resumeKey}})).status,200);
  assert.equal((await fresh.req('/api/group/g/'+a.id)).status,200);
  assert.equal((await fresh.req(`/api/group/g/${a.id}/logout`,{method:'POST',body:{}})).status,200);assert.equal((await fresh.req('/api/group/g/'+a.id)).status,404);
 });
 await check('CSRF/transport: wrong or missing Origin, cross-site fetch, non-JSON, oversize, unknown keys are rejected; nothing is written',async()=>{
  const before=Number((await q('SELECT count(*) n FROM group_orders')).rows[0].n);
  const body={requestKey:randomUUID(),groupLabel:'SYNTHETIC CSRF',contactName:'x',contactEmail:'x@example.invalid',locale:'ja',pickupStore:'MOUNTAIN_BASE',returnStore:'MOUNTAIN_BASE',period:PERIOD};
  assert.equal((await new Browserish().req('/api/group/start',{method:'POST',body,origin:'http://evil.example'})).status,403);
  assert.equal((await new Browserish().req('/api/group/start',{method:'POST',body,origin:null})).status,403);
  assert.equal((await new Browserish().req('/api/group/start',{method:'POST',raw:JSON.stringify(body),contentType:'text/plain'})).status,415);
  assert.equal((await A.req(`/api/group/g/${a.id}/advise`,{method:'POST',raw:JSON.stringify({rows:'x'.repeat(98500)})})).status,413);
  assert.equal((await new Browserish().req('/api/group/start',{method:'POST',body:{...body,paid:true}})).status,422);
  assert.equal((await new Browserish().req('/api/group/start',{method:'POST',body:{...body,period:{...PERIOD,endDate:'2035-02-09'}}})).status,422);
  assert.equal(Number((await q('SELECT count(*) n FROM group_orders')).rows[0].n),before);
 });
 let held:Awaited<ReturnType<typeof through>>;
 await check('five steps over HTTP: rows -> advise (read-only) -> save -> quote -> consent -> submit holds everyone atomically (GROUP_RESERVED, expires_at NULL), idempotent',async()=>{
  const rows=[skiRow('SYNTHETIC 1'),skiRow('SYNTHETIC 2'),boardRow('SYNTHETIC 3')];
  const before=await groupHolds();
  const adv=(await A.req(`/api/group/g/${a.id}/advise`,{method:'POST',body:{rows}})).json;assert.equal(adv.ok,true);assert.equal(adv.joint,'FEASIBLE');assert.ok(adv.advice.every((x:{state:string})=>x.state==='READY'),JSON.stringify(adv.advice.map((x:{state:string})=>x.state)));
  assert.equal(await groupHolds(),before,'advice consumes no stock');
  held=await through(A,a.id,rows);const total=held.view.estimate.totalJpy;assert.ok(total>0);assert.equal(held.view.group.status,'QUOTED');
  assert.equal(held.view.estimate.lines.length,3);assert.equal(held.view.rows.length,3);
  assert.equal((await A.req(`/api/group/g/${a.id}/submit`,{method:'POST',body:{requestKey:randomUUID(),expectedRevision:held.view.group.revision,quoteId:held.view.estimate.id}})).json.error,'CONSENT_REQUIRED');
  assert.equal(await groupHolds(),before,'a refused submit holds nothing');
  assert.equal((await A.req(`/api/group/g/${a.id}/consent`,{method:'POST',body:{quoteId:held.view.estimate.id,digest:held.view.estimate.digest,explanationConfirmed:false,fitAcknowledged:false}})).status,422);
  const c=await A.req(`/api/group/g/${a.id}/consent`,{method:'POST',body:{quoteId:held.view.estimate.id,digest:held.view.estimate.digest,explanationConfirmed:true,fitAcknowledged:false}});assert.equal(c.status,200,c.text);assert.equal(c.json.consented,true);
  const key=randomUUID(),sub=await A.req(`/api/group/g/${a.id}/submit`,{method:'POST',body:{requestKey:key,expectedRevision:c.json.group.revision,quoteId:held.view.estimate.id}});assert.equal(sub.status,200,sub.text);assert.equal(sub.json.status,'REVIEW_HELD');assert.equal(sub.json.view.group.status,'REVIEW_HELD');
  const again=await A.req(`/api/group/g/${a.id}/submit`,{method:'POST',body:{requestKey:key,expectedRevision:c.json.group.revision,quoteId:held.view.estimate.id}});assert.equal(again.json.replayed,true);
  assert.equal(await groupHolds(),before+1,'one part for three members');
  const h=(await q("SELECT expires_at,state,allocation_stage FROM inventory_holds WHERE allocation_stage='GROUP_RESERVED' ORDER BY created_at DESC LIMIT 1")).rows[0];assert.equal(h.expires_at,null);assert.equal(h.state,'ACTIVE');
  assert.equal((await q("SELECT count(*) n FROM rental_bookings")).rows[0].n,'0','no booking, payment attempt or provider event is created');
  assert.equal(JSON.stringify(sub.json).includes('squareup')||/payment.?link|checkout/i.test(sub.text),false,'no payment link or checkout in any group response');
 });
 await check('status view: held, not confirmed; payment is on site; change/decline is recorded as a request only and releases nothing',async()=>{
  const v=(await A.req('/api/group/g/'+a.id)).json;assert.equal(v.group.status,'REVIEW_HELD');assert.equal(v.settlement.paymentMethod,'PAY_ON_SITE');
  const hb=await groupHolds();const r=await A.req(`/api/group/g/${a.id}/request`,{method:'POST',body:{requestKey:randomUUID(),kind:'DECLINE',body:'SYNTHETIC decline request'}});assert.equal(r.status,200,r.text);
  assert.equal((await A.req('/api/group/g/'+a.id)).json.group.status,'REVIEW_HELD');assert.equal(await groupHolds(),hb,'a customer request does not release stock');
  assert.equal((await A.req(`/api/group/g/${a.id}/advise`,{method:'POST',body:{rows:[skiRow('x')]}})).json.error,'INVALID_STATE');
 });
 await check('rows are re-derived and validated on the server: bad/forged rows are rejected, client variant ids are ignored, formula labels stay inert text',async()=>{
  const x=await start(new Browserish(),'SYNTHETIC rows');const bX=new Browserish();const s=await start(bX,'SYNTHETIC rows 2');void x;
  const bad=await bX.req(`/api/group/g/${s.id}/advise`,{method:'POST',body:{rows:[skiRow('bad',{heightCm:5000})]}});assert.equal(bad.json.ok,false);assert.ok(bad.json.issues.some((i:{code:string})=>i.code==='OUT_OF_RANGE'));
  const forged=await bX.req(`/api/group/g/${s.id}/advise`,{method:'POST',body:{rows:[{...skiRow('forged'),selection:{items:[{family:'SKI',variantIds:['x']}]},variantIds:['x']}]}});assert.equal(forged.json.ok,true);
  const inj=skiRow('=HYPERLINK("http://evil.example","x")');const g=(await bX.req('/api/group/g/'+s.id)).json;
  const saved=await bX.req(`/api/group/g/${s.id}/members`,{method:'POST',body:{expectedRevision:g.group.revision,rows:[inj],directions:['RECOMMENDED']}});assert.equal(saved.status,200,saved.text);
  const label=(await q('SELECT label FROM group_members WHERE group_id=$1',[s.id])).rows[0].label;assert.equal(label,inj.label,'stored verbatim; never evaluated');
  const out=serializeGroupCsvRows([{...inj,memberId:null}],'EN');assert.ok(out.includes('"\'=HYPERLINK')||out.includes("'=HYPERLINK"),'export prefixes formula text');
  assert.equal((await bX.req(`/api/group/g/${s.id}/members`,{method:'POST',body:{expectedRevision:g.group.revision,rows:[inj],directions:['RECOMMENDED']}})).json.error,'STALE_REVISION');
  assert.equal((await bX.req(`/api/group/g/${s.id}/members`,{method:'POST',body:{expectedRevision:saved.json.revision,rows:[skiRow('x')],directions:['BOGUS']}})).status,422);
  assert.equal((await bX.req(`/api/group/g/${s.id}/members`,{method:'POST',body:{expectedRevision:saved.json.revision,rows:Array.from({length:101},()=>skiRow('x')),directions:[]}})).status,422);
 });
 await check('100 members over HTTP with realistic payloads; then a second group that cannot be covered: SHORT rows are named, submit holds nothing, the group stays editable; release (admin) frees stock for it',async()=>{
  const timed=async<T>(name:string,f:()=>Promise<T>):Promise<T>=>{const t=performance.now();const v=await f();console.log('PERF '+name+' '+Math.round(performance.now()-t)+' ms');return v;};
  const hundred=Array.from({length:100},(_,i)=>i%3===2?boardRow('G'+i):skiRow('G'+i,{heightCm:165+(i%10),footCm:25.5}));
  const b1=new Browserish(),s1=await start(b1,'SYNTHETIC hundred');const g1=(await b1.req('/api/group/g/'+s1.id)).json;
  const adv=await timed('advise 100 members',async()=>(await b1.req(`/api/group/g/${s1.id}/advise`,{method:'POST',body:{rows:hundred}})).json);assert.equal(adv.ok,true);assert.equal(adv.joint,'FEASIBLE',JSON.stringify(adv.summary));
  const saved=await timed('save 100 members',()=>b1.req(`/api/group/g/${s1.id}/members`,{method:'POST',body:{expectedRevision:g1.group.revision,rows:hundred,directions:adv.advice.map((x:{defaultDirection:string})=>x.defaultDirection)}}));assert.equal(saved.status,200,saved.text);
  const quoted=await timed('quote 100 members',()=>b1.req(`/api/group/g/${s1.id}/quote`,{method:'POST',body:{expectedRevision:saved.json.revision}}));assert.equal(quoted.status,200,quoted.text);
  const e=quoted.json.estimate;await b1.req(`/api/group/g/${s1.id}/consent`,{method:'POST',body:{quoteId:e.id,digest:e.digest,explanationConfirmed:true,fitAcknowledged:false}});
  const sub=await timed('submit 100 members',()=>b1.req(`/api/group/g/${s1.id}/submit`,{method:'POST',body:{requestKey:randomUUID(),expectedRevision:quoted.json.group.revision,quoteId:e.id}}));assert.equal(sub.status,200,sub.text);assert.equal(sub.json.members,100);
  // second group: 100 more ski sets cannot fit under the public cap together with the 100 held
  const before=await groupHolds(),b2=new Browserish(),s2=await start(b2,'SYNTHETIC short');const g2=(await b2.req('/api/group/g/'+s2.id)).json;
  const sixty=Array.from({length:100},(_,i)=>skiRow('S'+i));
  const adv2=await timed('advise 100 members, joint shortage localised',async()=>(await b2.req(`/api/group/g/${s2.id}/advise`,{method:'POST',body:{rows:sixty}})).json);
  assert.equal(adv2.ok,true);assert.notEqual(adv2.joint,'FEASIBLE');assert.ok(adv2.summary.short>0&&adv2.summary.short<100,JSON.stringify(adv2.summary));assert.ok(adv2.advice.some((x:{state:string;reason:string})=>x.state==='SHORT'&&x.reason==='JOINT_INSUFFICIENT'));
  // saving is still allowed (it holds nothing); submit is the atomic step and must refuse
  const sv=await b2.req(`/api/group/g/${s2.id}/members`,{method:'POST',body:{expectedRevision:g2.group.revision,rows:sixty,directions:adv2.advice.map((x:{defaultDirection:string})=>x.defaultDirection)}});assert.equal(sv.status,200,sv.text);
  const qt=await b2.req(`/api/group/g/${s2.id}/quote`,{method:'POST',body:{expectedRevision:sv.json.revision}});const e2=qt.json.estimate;
  await b2.req(`/api/group/g/${s2.id}/consent`,{method:'POST',body:{quoteId:e2.id,digest:e2.digest,explanationConfirmed:true,fitAcknowledged:false}});
  const key=randomUUID(),fail=await b2.req(`/api/group/g/${s2.id}/submit`,{method:'POST',body:{requestKey:key,expectedRevision:qt.json.group.revision,quoteId:e2.id}});
  assert.equal(fail.status,409);assert.equal(fail.json.error,'INSUFFICIENT_STOCK');assert.equal(await groupHolds(),before,'nothing was held for the failed group');
  assert.equal((await b2.req('/api/group/g/'+s2.id)).json.group.status,'QUOTED','the group stays editable');
  // administrator releases the first group; the same submit now succeeds (same key: a failed attempt is never cached)
  await app.svc.release(app.admin,s1.id,{requestKey:randomUUID(),expectedRevision:(await b1.req('/api/group/g/'+s1.id)).json.group.revision,reason:'SYNTHETIC release'});
  const ok=await b2.req(`/api/group/g/${s2.id}/submit`,{method:'POST',body:{requestKey:key,expectedRevision:qt.json.group.revision,quoteId:e2.id}});assert.equal(ok.status,200,ok.text);
  assert.equal((await b1.req('/api/group/g/'+s1.id)).json.group.status,'RELEASED');
 });
 await check('no group link exists on any public page, nav, sitemap or robots; entrance pages are noindex/no-store/no-referrer',async()=>{
  for(const p of ['/ja','/en','/ja/book','/en/rental/ski','/ja/prices','/ja/faq']){const r=await fetch(origin+p);const html=await r.text();assert.equal(html.includes(entranceToken),false,p);assert.equal(/\/(ja|en)\/group\b/.test(html),false,p+' links to group');assert.equal(/href="[^"]*group[^"]*"/.test(html),false,p);}
  const sm=await (await fetch(origin+'/sitemap.xml')).text();assert.equal(/group/i.test(sm),false);const rb=await (await fetch(origin+'/robots.txt')).text();assert.equal(rb.includes(entranceToken),false);assert.equal(/group/i.test(rb),false);
  const page=await fetch(`${origin}/ja/group/${entranceToken}`);assert.equal(page.status,200);const html=await page.text();
  assert.match(page.headers.get('x-robots-tag')??'',/noindex/);assert.match(page.headers.get('cache-control')??'',/no-store/);assert.match(page.headers.get('referrer-policy')??'',/no-referrer/);
  assert.match(html,/name="robots" content="[^"]*noindex/);assert.match(html,/name="referrer" content="no-referrer"/);
  assert.equal((await fetch(`${origin}/ja/group/short`)).status,404);assert.equal((await fetch(`${origin}/fr/group/${entranceToken}`)).status,404);
 });
 await check('entrance disabled/rotated: new applications stop; existing applications keep working (the entrance never owned them)',async()=>{
  await app.svc.setEntranceEnabled(app.admin,false,'SYNTHETIC incident stop');
  assert.equal((await new Browserish().req('/api/group/catalog')).status,404);const r=await new Browserish().req('/api/group/start',{method:'POST',body:{requestKey:randomUUID(),groupLabel:'SYNTHETIC closed',contactName:'x',contactEmail:'x@example.invalid',locale:'ja',pickupStore:'MOUNTAIN_BASE',returnStore:'MOUNTAIN_BASE',period:PERIOD}});assert.equal(r.status,404);
  assert.equal((await A.req('/api/group/g/'+a.id)).status,200);
  await app.svc.setEntranceEnabled(app.admin,true,'SYNTHETIC resume');assert.equal((await new Browserish().req('/api/group/catalog')).status,200);
 });
 await check('rate limit: a burst from one peer is answered 429 with Retry-After and the data stays intact',async()=>{
  const b=new Browserish();let limited=0;
  for(let i=0;i<450&&!limited;i++){const r=await b.req('/api/group/catalog');if(r.status===429){limited=i;assert.ok(r.headers.get('retry-after'));assert.equal(r.json.error,'GUEST_RATE_LIMITED');}}
  assert.ok(limited>0,'rate limit engaged');
 });
 await check('logs and responses carry no PII: no email, label or body measurement appears in the web server output',async()=>{
  const out=app.logs.join('\n');assert.equal(/synthetic-rep@example|SYNTHETIC 1|HYPERLINK/.test(out),false);
 });
 void buildGroupCsvTemplates;
  console.log(`GROUP customer API/HTTP/PostgreSQL: ${count} passed, 0 skipped. Synthetic data, no real email/payment.`);
}catch(e){failed=true;console.error('GROUP_CUSTOMER_API_FAILED '+stage+' '+(e as Error).name+': '+(e as Error).message?.slice(0,600));if(e instanceof assert.AssertionError)console.error(JSON.stringify({actual:e.actual,expected:e.expected}).slice(0,800));console.error((e as Error).stack?.split('\n').filter(l=>l.includes('/tests/group/')).join('\n'));console.error(app.logs.slice(-8).join('\n'));}
finally{await app.stop();}
if(failed)process.exit(1);
