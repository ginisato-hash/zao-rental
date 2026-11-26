import {test} from 'node:test';
import assert from 'node:assert/strict';
import {safeDiagnostic,logUnexpected} from '../../apps/web/src/lib/safe-diagnostic';
import {staffOperationDiagnostic} from '../../apps/web/src/lib/staff-operation-diagnostic';
import {guestCouponUniform} from '../../packages/core/src/guest/security';
import {readDatabaseReadiness} from '../../packages/db/src/internal/database-readiness';

// Forbidden in any server log line: e-mail, UUID (booking / item id), QR payload, long number (phone, card, amount), credential words,
// a person's name or free text taken from an error message.
const SECRETS=['tanaka.taro@example.com','9ee2f71e-a58f-4d8a-bf44-0d9cc2200bf5','zao-rental:reservation:9ee2f71e-a58f-4d8a-bf44-0d9cc2200bf5','田中太郎','090-1234-5678','09012345678','4111111111111111','Bearer abc.def.ghi','session=sk_live_SECRET','postgres'+'://user:hunter2@db.internal:5432/app','https://evil.example/open?id=1'];
const FORBIDDEN=[/@/,/[0-9a-f]{8}-[0-9a-f]{4}-/i,/zao-rental:reservation/,/田中/,/\d{6,}/,/bearer/i,/cookie/i,/session=/i,/sk_live/i,/postgres:\/\//i,/hunter2/,/evil\.example/,/https?:\/\//i,/password/i];
function assertClean(text:string,where:string){for(const re of FORBIDDEN)assert.equal(re.test(text),false,where+' leaked '+re+': '+text.slice(0,200));for(const s of SECRETS)assert.equal(text.includes(s),false,where+' leaked a secret value');}
function capture<T>(fn:()=>Promise<T>|T):Promise<{lines:string[];result?:T;error?:unknown}>{
 const lines:string[]=[],orig={e:console.error,l:console.log,i:console.info,w:console.warn,d:console.debug};
 const push=(...a:unknown[])=>{lines.push(a.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' '));};
 console.error=push;console.log=push;console.info=push;console.warn=push;console.debug=push;
 return Promise.resolve().then(fn).then(result=>({lines,result}),error=>({lines,error})).finally(()=>{console.error=orig.e;console.log=orig.l;console.info=orig.i;console.warn=orig.w;console.debug=orig.d;});
}
const hostile=(message:string)=>Object.assign(new Error(message),{code:'42P01',table:'rental_x',detail:'Key (email)=(tanaka.taro@example.com) already exists',query:'SELECT * FROM customers WHERE email=\'tanaka.taro@example.com\'',parameters:SECRETS,headers:{cookie:'session=sk_live_SECRET',authorization:'Bearer abc.def.ghi'},body:{name:'田中太郎',qr:SECRETS[2]}});

test('a diagnostic carries SQLSTATE, schema names and a fixed code only; the free-text message is never present',()=>{
 const d=safeDiagnostic('custody',Object.assign(new Error('relation "x" does not exist for 田中太郎'),{code:'42P01',table:'x',secret:'never'}));
 assert.deepEqual(d,{route:'custody',errorName:'Error',pgCode:'42P01',table:'x',column:undefined,routine:undefined,errorCode:undefined});
 assert.equal('message' in d,false);
 assert.equal(safeDiagnostic('bad route!',null).route,'unknown');
 assert.equal(safeDiagnostic('custody',{code:'not-a-state'}).pgCode,undefined);
 assert.equal(safeDiagnostic('custody',new Error('CUSTODY_FAILED')).errorCode,'CUSTODY_FAILED');
 assert.equal(safeDiagnostic('custody',new Error('TANAKA')).errorCode,undefined,'a bare word (possibly a name) is not a code');
});

test('logUnexpected never writes message, query, parameters, headers, body, QR text, e-mail, name, phone or id to the log',async()=>{
 for(const message of [...SECRETS,SECRETS.join(' | '),'duplicate key value violates unique constraint "customers_email_key" tanaka.taro@example.com']){
  const out=await capture(()=>logUnexpected('custody',hostile(message)));
  assert.equal(out.lines.length,1);assertClean(out.lines.join('\n'),'logUnexpected');
 }
 const proxy=new Proxy({},{get(){throw new Error('tanaka.taro@example.com');}});
 const out=await capture(()=>logUnexpected('custody',proxy));assertClean(out.lines.join('\n'),'hostile proxy');
 const nonObjects=await capture(()=>{logUnexpected('custody','tanaka.taro@example.com');logUnexpected('custody',null);logUnexpected('custody',undefined);});assertClean(nonObjects.lines.join('\n'),'non-error values');
});

test('the staff-users diagnostic carries a phase, a SQLSTATE class and a random id only',()=>{
 const d=staffOperationDiagnostic(hostile('tanaka.taro@example.com'),'WRITE');assertClean(JSON.stringify({...d,correlationId:'random'}),'staffOperationDiagnostic');assert.match(d.correlationId,/^[0-9a-f-]{36}$/);
 assert.deepEqual(Object.keys(d).sort(),['category','code','correlationId','phase']);
});

test('the guest coupon rejection log carries a fixed reason code, never the typed coupon code or any message',async()=>{
 const out=await capture(()=>guestCouponUniform(async()=>{throw Object.assign(new Error('coupon tanaka.taro@example.com 田中太郎 090-1234-5678'),{code:'COUPON_NOT_FOUND'});}));
 assert.ok(out.error);assertClean(out.lines.join('\n'),'guest coupon');assert.ok(out.lines.every(l=>/^\{"event":"guest_coupon_rejected","reason":"[A-Z_]+"\}$/.test(l)));
});

test('database readiness reports a fixed code, never the driver message (host, role, credential)',async()=>{
 const cfg={} as never;
 for(const message of SECRETS){const r=await readDatabaseReadiness(cfg,1,async()=>{throw Object.assign(new Error('password authentication failed for user "'+message+'"'),{code:'28P01'});});
  assert.equal(r.status,'FAILED');assertClean(JSON.stringify(r),'readiness');assert.equal((r as {reason:string}).reason,'SQLSTATE_28P01');}
 const plain=await readDatabaseReadiness(cfg,1,async()=>{throw new Error('connect ECONNREFUSED 10.0.0.12:5432 postgres'+'://user:hunter2@db.internal');});assertClean(JSON.stringify(plain),'readiness plain');
 assert.equal((plain as {reason:string}).reason,'DATABASE_READINESS_FAILED');
});
