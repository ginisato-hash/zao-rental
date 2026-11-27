import {productionRequested,getProductionRuntime} from './production-runtime';
import 'server-only';
import {Pool} from 'pg';
import type {Connection} from '../../../../packages/auth/src/config';
import {GroupOrderService} from '../../../../packages/core/src/group/group-service';
import {GroupCustomerService} from '../../../../packages/core/src/group/group-customer';
import {GuestSecurity,guestPeerKey} from '../../../../packages/core/src/guest/security';
import {publicRuntime} from './public-runtime';
import type {GroupBoundary} from './group-http';
let groupPool:Pool|undefined;
/** Group customer boundary. Production: the composed production runtime offers it ONLY when the dedicated `<db>_group` role has its credential, passed the
 * identity/least-privilege check and the database is ready (0064 applied, the role's grants present); otherwise `group` is null and the route answers 503
 * GROUP_UNCONNECTED, exactly as before. The entrance is closed until an administrator enables it on /staff/groups (the database holds no entrance row until then).
 * Local development / test: the dedicated `<db>_group` role (never the migration or owner role) from ZAO_GROUP_RUNTIME. */
export function groupBoundary(policy?:{peerRequests:number;globalRequests:number}):GroupBoundary|null{
 if(productionRequested()){const g=getProductionRuntime()?.group;return g?{customer:g.customer,origin:g.origin,serverKey:g.serverKey,guard:g.guard}:null;}
 if(process.env.NODE_ENV==='production')return null;
 const p=publicRuntime(),raw=process.env.ZAO_GROUP_RUNTIME;if(!p||!raw)return null;
 const c=JSON.parse(raw) as Connection;
 if(c.host!=='127.0.0.1'||c.database!==p.r.config.namespace||c.user!==p.r.config.namespace+'_group'||c.port!==p.r.config.authDb.port||!c.password)throw new Error('GROUP_RUNTIME_INVALID');
 if(!groupPool){groupPool=new Pool({...c,max:6,connectionTimeoutMillis:3000});groupPool.on('error',()=>{});}
 const svc=new GroupOrderService(groupPool),customer=new GroupCustomerService(svc,groupPool,p.readPool);
 const security=new GuestSecurity(p.guestPool,p.contexts,{version:'group-local-v1',contextSeconds:3600,absoluteSeconds:86400,recoverySeconds:43200,replaySeconds:600,retentionSeconds:86400,windowSeconds:60,peerRequests:policy?.peerRequests??120,globalRequests:policy?.globalRequests??1000},p.r.config.authSecret);
 return {customer,origin:p.r.config.origin,serverKey:p.r.config.authSecret,guard:()=>security.guard(guestPeerKey('127.0.0.1',p.r.config.authSecret))};
}
