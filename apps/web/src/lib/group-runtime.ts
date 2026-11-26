import {productionRequested} from './production-runtime';
import 'server-only';
import {Pool} from 'pg';
import type {Connection} from '../../../../packages/auth/src/config';
import {GroupOrderService} from '../../../../packages/core/src/group/group-service';
import {GroupCustomerService} from '../../../../packages/core/src/group/group-customer';
import {GuestSecurity,guestPeerKey} from '../../../../packages/core/src/guest/security';
import {publicRuntime} from './public-runtime';
import type {GroupBoundary} from './group-http';
let groupPool:Pool|undefined;
/** Group customer boundary for the local development / test composition only: the dedicated `<db>_group` role (never the migration or
 * owner role) from ZAO_GROUP_RUNTIME. Production is deliberately not connected here: the production group role delta and its
 * composition (GROUP_INVITE_CORE.md section 6) are a separate, reviewed step, so the route answers 503 GROUP_UNCONNECTED until then. */
export function groupBoundary(policy?:{peerRequests:number;globalRequests:number}):GroupBoundary|null{
 if(productionRequested()||process.env.NODE_ENV==='production')return null;
 const p=publicRuntime(),raw=process.env.ZAO_GROUP_RUNTIME;if(!p||!raw)return null;
 const c=JSON.parse(raw) as Connection;
 if(c.host!=='127.0.0.1'||c.database!==p.r.config.namespace||c.user!==p.r.config.namespace+'_group'||c.port!==p.r.config.authDb.port||!c.password)throw new Error('GROUP_RUNTIME_INVALID');
 if(!groupPool){groupPool=new Pool({...c,max:6,connectionTimeoutMillis:3000});groupPool.on('error',()=>{});}
 const svc=new GroupOrderService(groupPool),customer=new GroupCustomerService(svc,groupPool,p.readPool);
 const security=new GuestSecurity(p.guestPool,p.contexts,{version:'group-local-v1',contextSeconds:3600,absoluteSeconds:86400,recoverySeconds:43200,replaySeconds:600,retentionSeconds:86400,windowSeconds:60,peerRequests:policy?.peerRequests??120,globalRequests:policy?.globalRequests??1000},p.r.config.authSecret);
 return {customer,origin:p.r.config.origin,serverKey:p.r.config.authSecret,guard:()=>security.guard(guestPeerKey('127.0.0.1',p.r.config.authSecret))};
}
