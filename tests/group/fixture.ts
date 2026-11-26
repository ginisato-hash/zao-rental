import {randomUUID,randomBytes} from 'node:crypto';
import {flowFixture} from '../flow/fixture';
import {provisionGroupRole} from '../../scripts/group-role';
import {GroupOrderService,type StaffActor,type OwnerActor} from '../../packages/core/src/group/group-service';
import {writeAccount} from '../../packages/auth/src/accounts';
import {loadStaff} from '../../packages/auth/src/staff-auth';
import {fid,variants} from '../inventory/fixture';
import type {GroupMemberInput} from '../../packages/contracts/src/group-order';
export const PERIOD={startDate:'2035-02-10',endDate:'2035-02-10',slot:'DAY'} as const;
export const secret=()=>randomBytes(32).toString('base64url');
export const skiMember=(label:string,extra:Partial<GroupMemberInput['selection']>={}):GroupMemberInput=>({label,profile:{heightCm:170,footCm:25.5,synthetic:true},selection:{product:'SKI_SET',age:'ADULT',tier:'REGULAR',items:[{family:'SKI',variantIds:[variants.ski]},{family:'SKI_BOOT',variantIds:[variants.boot]},{family:'POLE',variantIds:[variants.pole]}],...extra}});
/** Isolated PostgreSQL (all migrations) + application roles + the dedicated group role. Synthetic data only. */
export async function groupFixture(stock=150){
 const x=await flowFixture('2035-01-01T10:00:00+09:00',true);let g:Awaited<ReturnType<typeof provisionGroupRole>>|undefined;
 try{
  g=await provisionGroupRole(x.db.pool,x.db.identity);
  const c=await x.db.pool.connect();
  try{await c.query('BEGIN');await c.query("SELECT set_config('zao.actor','synthetic-group-seed',true),set_config('zao.reason','SYNTHETIC group stock',true)");
   for(const [family,variant,base] of [['SKI',variants.ski,20000],['SKI_BOOT',variants.boot,21000]] as const)for(let n=0;n<stock-1;n++)await c.query(`INSERT INTO ledger_assets(id,variant_id,family,initial_store_id,store_id,status,bsl_status,bsl_evidence,notes,source_kind,source_document,source_locator) VALUES($1,$2,$3,'MOUNTAIN_BASE','MOUNTAIN_BASE','AVAILABLE',$4,'','','SYNTHETIC','tests/group/fixture.ts',$5)`,[fid(base+n),variant,family,family==='SKI_BOOT'?'UNVERIFIED':'NOT_APPLICABLE','GROUP-'+family+'-'+n]);
   await c.query('UPDATE ledger_poles SET quantity=$1,version=version+1 WHERE id=$2',[stock,fid(1301)]);await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  const svc=new GroupOrderService(g.groupPool,x.now);
  const admin:StaffActor={kind:'STAFF',subject:x.principal.subject,revision:x.principal.revision};
  const mgr=(await writeAccount(x.roles.authPool,x.bp,undefined,{email:'group-mgr@example.invalid',password:x.password,displayName:'SYNTHETIC Manager',active:true,role:'MANAGER',scope:'ALL',storeIds:[],permissions:{BOOKING_VIEW:true}})).id!;
  const mp=(await loadStaff(x.db.pool,mgr))!;const manager:StaffActor={kind:'STAFF',subject:mp.subject,revision:mp.revision};
  async function entrance(){return (await svc.rotateEntrance(admin,'SYNTHETIC test entrance')).token;}
  async function start(token:string,label='SYNTHETIC group',period:{startDate:string;endDate:string;slot:'DAY'}=PERIOD){
   const s=secret();const r=await svc.startApplication(token,randomUUID(),s,{groupLabel:label,contactName:'SYNTHETIC Rep',contactEmail:'synthetic-rep@example.invalid',locale:'ja',pickupStore:'MOUNTAIN_BASE',returnStore:'MOUNTAIN_BASE',contractVersion:'INTEGRATED_V1_4',period});
   const owner:OwnerActor={kind:'OWNER',groupId:r.groupId,secret:s};return {owner,groupId:r.groupId,revision:r.revision};
  }
  /** application -> members -> quote -> consent (no inventory yet) */
  async function quoted(token:string,count:number,label='SYNTHETIC group'){
   const a=await start(token,label);const m=await svc.saveMembers(a.owner,a.groupId,a.revision,Array.from({length:count},(_,i)=>skiMember('m'+(i+1))));
   const q=await svc.quote(a.owner,a.groupId,m.revision);await svc.consent(a.owner,a.groupId,{quoteId:q.quoteId,digest:q.digest,termsVersion:'SYNTHETIC-T1',termsSha256:'a'.repeat(64),explanationConfirmed:true});
   return {...a,revision:q.revision,quote:q,memberIds:m.memberIds};
  }
  async function held(token:string,count:number,label?:string){const q=await quoted(token,count,label);const s=await svc.submit(q.owner,q.groupId,{requestKey:randomUUID(),expectedRevision:q.revision,quoteId:q.quote.quoteId});return {...q,revision:s.revision,submit:s};}
  return {...x,svc,admin,manager,entrance,start,quoted,held,groupPool:g.groupPool,async close(){await g!.close();await x.close();}};
 }catch(e){await g?.close();await x.close();throw e;}
}
