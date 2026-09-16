// Synthetic, owned local PostgreSQL only. No provider connector is used here.
import {randomBytes} from 'node:crypto';
import {Pool} from 'pg';
import {flowFixture} from '../flow/fixture';
import {provisionGuestRole} from '../../scripts/guest-roles';
import {provisionContentRole} from '../../scripts/content-roles';
import {provisionBookingAccessRole} from '../../scripts/booking-access-role';
import {provisionOperationsRole} from '../../scripts/operations-roles';
import {provisionAvatarReadRole} from '../../scripts/avatar-read-role';
import {productionConfiguration,productionServices,type ProductionFlags,type ProductionService} from '../../packages/auth/src/production-config';
import {productionGuestConfiguration,guestConfigurationHash} from '../../packages/contracts/src/production-guest';
import {productionConfigurationDigest,type ProductionRuntimeInput} from '../../packages/core/src/guest/production-runtime';
import type {Connection} from '../../packages/auth/src/config';
export async function normalProductionFixture(){
 const x=await flowFixture();const closers:(()=>Promise<void>)[]=[];
 try{
  const guest=await provisionGuestRole(x.db.pool,x.db.identity);closers.push(guest.close);
  const content=await provisionContentRole(x.db.pool,x.db.identity);closers.push(content.close);
  const access=await provisionBookingAccessRole(x.db.pool,x.db.identity);closers.push(access.close);
  const operations=await provisionOperationsRole(x.db.pool,x.db.identity);closers.push(operations.close);
  const avatar=await provisionAvatarReadRole(x.db.pool,x.db.identity);closers.push(avatar.close);
  const db:Record<ProductionService,Connection>={auth:x.roles.authDb,ledger:x.roles.ledgerDb,hold:x.roles.holdDb,transfer:x.roles.transferDb,pricing:x.roles.pricingDb,recommendation:x.roles.recommendationDb,operations:operations.operationsDb,guest:guest.guestDb,content_read:content.contentReadDb,avatar_read:avatar.avatarDb,booking_access:access.accessDb};
  const roots={guestKey:randomBytes(32).toString('hex'),staffKey:randomBytes(32).toString('hex'),accessKey:randomBytes(32).toString('hex'),recoveryKey:randomBytes(32).toString('hex'),accessKeyVersion:'synthetic-m15-access',recoveryKeyVersion:'synthetic-m15-recovery'};
  const policy=productionGuestConfiguration({schemaVersion:1,revision:'SYNTHETIC-M15-INTEGRATION',ingressAdapterId:'synthetic-m15-dispatcher',policy:{version:'SYNTHETIC-M15-INTEGRATION',contextSeconds:3600,absoluteSeconds:7200,recoverySeconds:3600,replaySeconds:30,retentionSeconds:60,windowSeconds:10,peerRequests:1000,globalRequests:2000}});
  function input(flags:Partial<ProductionFlags>={},origin='https://production-fixture.invalid'):ProductionRuntimeInput{
   const c=productionConfiguration({schemaVersion:1,capability:'ZAO_PRODUCTION_RUNTIME_V1',deployment:{provider:'VERCEL',environment:'production',projectId:'synthetic-m15-project',releaseId:'synthetic-m15-release',origin},database:{provider:'NEON',environment:'production',host:'ep-synthetic-m15.neon.tech',name:x.db.identity.database,roles:Object.fromEntries(productionServices.map(s=>[s,db[s].user]))},flags:{booking:true,guestRecovery:true,payment:false,media:false,avatar:false,staffOperations:true,...flags},guest:policy,approvedGuestSha256:guestConfigurationHash(policy),payment:null,media:flags.media?{provider:'CLOUDFLARE_R2',environment:'PRODUCTION',accountId:'a'.repeat(32),bucket:'synthetic-m15-private',visibility:'PRIVATE',r2DevEnabled:false,publicDomains:[],credentialExpiresAt:'2099-01-01T00:00:00Z'}:null});
   return {configuration:c,approvedConfigurationSha256:productionConfigurationDigest(c),deployment:c.deployment,secrets:{...roots,database:Object.fromEntries(productionServices.map(s=>[s,{provider:'NEON',environment:'PRODUCTION',host:c.database.host,port:5432,database:c.database.name,user:db[s].user,password:db[s].password,revoked:false}]))},verifiedPeer:()=>({...c.deployment,address:'192.0.2.15'}),connect:async(config,service,credential)=>{if(credential.password!==db[service].password||config.database.name!==x.db.identity.database)throw Error('SYNTHETIC_IDENTITY_MISMATCH');return new Pool({...db[service],max:2,connectionTimeoutMillis:2000});},audit:async()=>{}};
  }
  return {...x,guestRole:guest,accessRole:access,operationsRole:operations,avatarRole:avatar,input,async close(){await Promise.all(closers.map(close=>close()));await x.close();}};
 }catch(e){await Promise.all(closers.map(close=>close()));await x.close();throw e;}
}
