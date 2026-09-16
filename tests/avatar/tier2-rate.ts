import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {Pool} from 'pg';
import {startIsolatedPostgres} from '../../scripts/postgres';
import {migrate} from '../../packages/db/src/index';
import {provisionGuestRole} from '../../scripts/guest-roles';
import {GuestContexts} from '../../packages/core/src/guest/context';
import {GuestSecurity,guestPeerKey} from '../../packages/core/src/guest/security';
import {avatarGuestSecurity,avatarGuestPolicy} from '../../packages/core/src/avatar/guest-rate';
import {guestAvatarHandler,type GuestAvatarBoundary} from '../../apps/web/src/lib/guest-avatar-http';
import guestPolicy from '../../config/production/guest.p4-approved-policy.json';
const db=await startIsolatedPostgres();let role:Awaited<ReturnType<typeof provisionGuestRole>>|undefined,replica:Pool|undefined;
try{
 await migrate(db.pool);role=await provisionGuestRole(db.pool,db.identity);replica=new Pool(role.guestDb);
 await db.pool.query("CREATE OR REPLACE FUNCTION inventory_clock() RETURNS timestamptz LANGUAGE sql VOLATILE AS $$SELECT '2035-01-01T01:00:00Z'::timestamptz$$");
 const key=randomBytes(32).toString('hex'),contexts=new GuestContexts(role.guestPool),peer=guestPeerKey('192.0.2.10',key);
 const a=avatarGuestSecurity(role.guestPool,contexts,key),b=avatarGuestSecurity(replica,new GuestContexts(replica),key);
 const results=await Promise.all(Array.from({length:avatarGuestPolicy.peerRequests+2},(_,i)=>(i%2?a:b).guard(peer).then(()=>true,e=>{assert.equal(e.code,'GUEST_RATE_LIMITED');return false;})));
 assert.equal(results.filter(Boolean).length,avatarGuestPolicy.peerRequests);
 const counts=(await db.pool.query('SELECT count FROM guest_rate_buckets ORDER BY bucket')).rows.map(r=>r.count);
 assert.deepEqual(counts,[avatarGuestPolicy.peerRequests,avatarGuestPolicy.peerRequests]);
 let loads=0,reads=0;
 const boundary:GuestAvatarBoundary={guard:()=>b.guard(peer),load:async()=>{loads++;return {payloads:{APPEARANCE_1:null,APPEARANCE_2:null},previewId:'20000000-0000-4000-8000-000000000003'};},reader:()=>({findForDelivery:async()=>{reads++;return null;},readBytes:async()=>{reads++;return null;}})};
 const scope='20000000-0000-4000-8000-000000000001/1/person-1',metadata='/api/guest/avatar/'+scope;
 for(const media of [false,true]){
  const path=media?'/guest-avatar-media/'+scope+'/20000000-0000-4000-8000-000000000002/'+'a'.repeat(64):metadata;
  const r=await guestAvatarHandler(()=>boundary,media)(new Request('http://127.0.0.1:12345'+path));
  assert.equal(r.status,429);assert.equal(r.headers.get('Retry-After'),'60');assert.equal(r.headers.get('Cache-Control'),'private, no-store');assert.equal(await r.text(),'');
 }
 assert.deepEqual({loads,reads},{loads:0,reads:0});
 // Exhausted Avatar fan-out does not consume the ordinary booking policy bucket.
 await new GuestSecurity(role.guestPool,contexts,guestPolicy.policy,key).guard(peer);
 for(const table of ['guest_drafts','recommendation_previews','inventory_holds','price_quotes','rental_bookings','rental_payment_attempts'])assert.equal((await db.pool.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n,0);
 await db.pool.query("CREATE OR REPLACE FUNCTION inventory_clock() RETURNS timestamptz LANGUAGE sql VOLATILE AS $$SELECT '2035-01-01T01:01:00Z'::timestamptz$$");
 const restored=await guestAvatarHandler(()=>boundary,false)(new Request('http://127.0.0.1:12345'+metadata));assert.equal(restored.status,200);assert.deepEqual({loads,reads},{loads:1,reads:0});
 console.log('PASS Tier2 real-PG Avatar rate limit across two pools; metadata/media429 before load; booking budget isolated; next window recovers; business writes0');
}finally{await replica?.end();await role?.close();await db.stop();console.log('Owned Tier2 rate-limit PostgreSQL closed.');}
