import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,readFileSync,statSync} from 'node:fs';
import {join} from 'node:path';
// COUPON-RESERVE-01: QuoteService.reserveCoupon (the staff-only slot reservation) is deliberately not wired to any route, service or
// screen. Quote creation counts active reservations + live bookings and booking creation counts live bookings, so while nothing calls it
// the three limit checks agree. If a caller is ever added, the counting rules (quote: reservations + bookings; booking: bookings only,
// because the booking role cannot read coupon_reservations) must be reconciled first -- this test makes that decision explicit.
function walk(dir:string,out:string[]=[]){for(const n of readdirSync(dir)){if(n==='node_modules'||n==='.next'||n.startsWith('.'))continue;const p=join(dir,n),s=statSync(p);if(s.isDirectory())walk(p,out);else if(/\.(ts|tsx|mjs)$/.test(n))out.push(p);}return out;}
test('reserveCoupon has no caller outside its own definition (and tests)',()=>{
 const callers=['apps/web/src','packages','scripts'].flatMap(d=>walk(d)).filter(f=>/\breserveCoupon\b/.test(readFileSync(f,'utf8')));
 assert.deepEqual(callers,['packages/core/src/pricing/quote-service.ts']);
 const src=readFileSync('packages/core/src/pricing/quote-service.ts','utf8');
 assert.equal((src.match(/\.reserveCoupon\(/g)??[]).length,0,'no internal caller either');
});
