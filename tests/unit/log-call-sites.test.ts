import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,readFileSync,statSync} from 'node:fs';
import {join} from 'node:path';

// Every server/client log call site in product code is enumerated here. A new console.* call fails this test until it is reviewed
// to log only fixed codes / enums (never error.message, request bodies, QR text, names, e-mail, phone, headers or cookies).
const ALLOWED:Record<string,number>={
 'apps/backup-scheduler-worker/src/index.ts':1,// fixed event + numeric HTTP status
 'apps/web/src/app/api/staff-users/[[...record]]/route.ts':1,// staffOperationDiagnostic: phase + SQLSTATE class + random id
 'apps/web/src/lib/auth-http.ts':2,// regex-validated UPPER_SNAKE code only
 'apps/web/src/lib/safe-diagnostic.ts':1,// safeDiagnostic: route, error class, SQLSTATE, schema names, fixed code
 'apps/web/src/lib/worker-tick.ts':1,// forwards handleWorkerTick lines (event + state/counters/fixed code)
 'packages/core/src/guest/security.ts':1,// fixed coupon rejection reason code
};
const CALL=/\bconsole\.(?:log|info|warn|error|debug|trace)\s*\(/g;
function walk(dir:string,out:string[]=[]){for(const n of readdirSync(dir)){if(n==='node_modules'||n==='.next'||n==='dist')continue;const p=join(dir,n);const s=statSync(p);if(s.isDirectory())walk(p,out);else if(/\.(ts|tsx|mjs|js)$/.test(n))out.push(p);}return out;}
test('product code logs only through reviewed call sites',()=>{
 const found:Record<string,number>={};
 for(const root of ['apps','packages'])for(const f of walk(root)){const n=(readFileSync(f,'utf8').match(CALL)??[]).length;if(n)found[f]=n;}
 assert.deepEqual(found,ALLOWED);
});
test('no reviewed log call site interpolates an error message or request data',()=>{
 for(const f of Object.keys(ALLOWED)){const lines=readFileSync(f,'utf8').split('\n').filter(l=>/\bconsole\.(?:log|info|warn|error|debug)\s*\(/.test(l));
  for(const l of lines)assert.equal(/\.message\b|request\.(?:json|text|headers|url)|\.body\b|cookie|authorization/i.test(l.replace(/\/\*.*?\*\//g,'')),false,f+': '+l.trim().slice(0,160));}
});
