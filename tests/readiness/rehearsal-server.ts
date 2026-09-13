// Test executable only. Never imported by the normal application/runtime.
import {createServer,type Server} from 'node:http';
import {Pool} from 'pg';
import {worktreeIdentity,assertPortFree,rejectAmbientDatabase} from '../../scripts/worktree';
import {trackPoolLifecycle} from '../../scripts/pool-lifecycle';
import {exact} from '../../packages/contracts/src/pricing';
import {composeProductionGuestSecurity} from '../../packages/core/src/guest/production-composition';
import {createRequestPeerBoundary} from '../../packages/core/src/guest/request-peer-boundary';
import {BookingAccess} from '../../packages/core/src/guest/booking-access';
import {BookingRecovery} from '../../packages/core/src/guest/booking-recovery';
import {bookingAccessHandler} from '../../apps/web/src/lib/booking-access-http';
import type {Connection} from '../../packages/auth/src/config';
let server:Server|undefined;const closes:(()=>Promise<void>)[]=[];let stopping=false;
async function stop(code=0){if(stopping)return;stopping=true;try{if(server)await new Promise<void>(resolve=>{server!.close(()=>resolve());server!.closeIdleConnections();});for(const close of closes)await close();process.send?.({state:'STOPPED'});}catch{code=1;}finally{process.exit(code);}}
process.on('SIGTERM',()=>void stop());process.on('disconnect',()=>void stop());
process.once('message',async input=>{try{
 if(process.env.NODE_ENV!=='production'||!process.send)throw new Error();rejectAmbientDatabase();
 const c=exact(input,['kind','guestDb','accessDb','key','configuration','configurationSha256','externalTransport','productionActivation','chargeReady']),identity=worktreeIdentity();
 if(c.kind!=='SYNTHETIC_LOCAL_REHEARSAL'||c.externalTransport!=='DISABLED'||c.productionActivation!==false||c.chargeReady!==false||typeof c.key!=='string'||!/^[-_A-Za-z0-9]{43}$/.test(c.key))throw new Error();
 function pool(value:unknown,suffix:string){const d=exact(value,['host','port','database','user','password']) as Connection;if(d.host!=='127.0.0.1'||d.port!==identity.dbPort||d.database!==identity.database||d.user!==identity.namespace+suffix||typeof d.password!=='string'||!d.password)throw new Error();const p=new Pool({...d,max:2});closes.push(trackPoolLifecycle(p));return p;}
 const guestPool=pool(c.guestDb,'_guest'),accessPool=pool(c.accessDb,'_booking_access'),boundary=createRequestPeerBoundary('synthetic-production-dispatcher');
 const component=await composeProductionGuestSecurity({pool:guestPool,configuration:c.configuration,approvedConfigurationSha256:typeof c.configurationSha256==='string'?c.configurationSha256:undefined,serverKey:c.key,ingress:boundary.adapter,audit:async()=>{}});
 const key=Buffer.from(c.key,'base64url'),origin='https://rehearsal.invalid',handler=bookingAccessHandler(new BookingAccess(accessPool,key,'rehearsal-v1'),component.contexts,origin,r=>component.security.service.guard(component.security.peer(r)),new BookingRecovery(accessPool,key,'rehearsal-v1'));
 const port=identity.webPort+2;await assertPortFree(port);
 server=createServer(async(req,res)=>{try{
  if(req.url==='/health'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({live:true,productionActivation:false}));return;}
  if(req.url==='/ready'){await guestPool.query('SELECT 1');await accessPool.query('SELECT 1');res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({localRehearsalReady:true,productionReady:false,externalTransport:'DISABLED',chargeReady:false}));return;}
  if(!req.url?.startsWith('/api/booking-access')){res.writeHead(503);res.end();return;}
  const chunks:Buffer[]=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>16384)throw new Error();chunks.push(Buffer.from(chunk));}
  const headers=new Headers();for(const [k,v] of Object.entries(req.headers))if(v!==undefined)headers.set(k,Array.isArray(v)?v.join(','):v);
  const request=new Request(origin+req.url,{method:req.method??'GET',headers,...(req.method==='GET'?{}:{body:Buffer.concat(chunks)})});
  boundary.bind(request,{adapterId:boundary.adapter.id,address:req.socket.remoteAddress??''});
  const response=await handler(request);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
 }catch{res.writeHead(503,{'content-type':'application/json'});res.end('{"error":"REHEARSAL_UNAVAILABLE"}');}});
 await new Promise<void>(resolve=>server!.listen(port,'127.0.0.1',resolve));process.send({state:'READY',pid:process.pid,port});
 }catch{process.send?.({state:'STARTUP_REJECTED'});await stop(1);}});
