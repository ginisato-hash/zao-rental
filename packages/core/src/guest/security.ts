import {createHash,createHmac,randomBytes} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {type GuestActor} from '../../../auth/src/booking-actor';
import {canonical,HoldError} from '../../../contracts/src/hold';
import {flowId} from '../../../contracts/src/rental-flow';
import {guestSecurityPolicy,recoverySecret,type GuestSecurityPolicy} from '../../../contracts/src/guest-security';
import {GuestContexts} from './context';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const milliseconds=(n:number)=>n*1000;
/** Peer identity comes from a configured trusted ingress/socket adapter, NEVER arbitrary request headers. */
export function guestPeerKey(verifiedAddress:string,serverKey:string){if(!verifiedAddress||verifiedAddress.length>200||serverKey.length<32)throw new HoldError('TRUSTED_INGRESS_REQUIRED',503);return createHmac('sha256',serverKey).update('guest-peer-v1\0').update(verifiedAddress).digest('hex');}
export class GuestSecurity{
 readonly policy:Readonly<GuestSecurityPolicy>;
 constructor(readonly pool:Pool,readonly contexts:GuestContexts,policy:unknown,private serverKey:string){this.policy=guestSecurityPolicy(policy);if(serverKey.length<32)throw new HoldError('GUEST_KEY_REQUIRED',503);}
 private async checkPolicy(c:Pick<PoolClient,'query'>){const fingerprint=hash(canonical(this.policy));await c.query('INSERT INTO guest_policy_versions VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[this.policy.version,fingerprint,JSON.stringify(this.policy)]);if((await c.query('SELECT fingerprint FROM guest_policy_versions WHERE version=$1',[this.policy.version])).rows[0]?.fingerprint!==fingerprint)throw new HoldError('GUEST_POLICY_VERSION_CONFLICT',503);}
 async transaction<T>(fn:(c:PoolClient)=>Promise<T>){const c=await this.pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL lock_timeout='1500ms';SET LOCAL statement_timeout='5000ms'");await this.checkPolicy(c);const v=await fn(c);await c.query('COMMIT');return v;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
 async create(){await this.checkPolicy(this.pool);return this.contexts.create({contextSeconds:this.policy.contextSeconds,absoluteSeconds:this.policy.absoluteSeconds,policyVersion:this.policy.version});}
 async guard(peer:string|undefined){if(!peer||!/^[a-f0-9]{64}$/.test(peer))throw new HoldError('TRUSTED_INGRESS_REQUIRED',503);await this.transaction(async c=>{
  const now=(await c.query<{now:Date}>('SELECT inventory_clock() now')).rows[0]!.now,window=Math.floor(now.getTime()/milliseconds(this.policy.windowSeconds)),end=new Date((window+1)*milliseconds(this.policy.windowSeconds));
  // Stable order, one global budget bounds distinct peer buckets even during anonymous abuse.
  for(const [key,limit] of [['global',this.policy.globalRequests],[peer,this.policy.peerRequests]] as const){const bucket=this.policy.version+':'+key+':'+window;const row=(await c.query('INSERT INTO guest_rate_buckets VALUES($1,1,$2) ON CONFLICT(bucket) DO UPDATE SET count=guest_rate_buckets.count+1 WHERE guest_rate_buckets.count<$3 RETURNING count',[bucket,end,limit])).rows[0];if(!row)throw new HoldError('GUEST_RATE_LIMITED',429);}
 });}
 async metadata(actor:GuestActor){await this.contexts.read(actor);const r=(await this.pool.query('SELECT revision,recovery_until,absolute_at FROM guest_lifecycle WHERE context_id=$1',[actor.contextId])).rows[0];if(!r)throw new HoldError('GUEST_SECURITY_CONTEXT_REQUIRED',409);return {revision:r.revision,recoveryUntil:r.recovery_until,absoluteAt:r.absolute_at};}
 async enroll(actor:GuestActor,revision:unknown){if(!Number.isSafeInteger(revision))throw new HoldError('INVALID_RECOVERY_INPUT',422);const code=randomBytes(32).toString('base64url');return this.contexts.change(actor,async(c)=>{
  await this.checkPolicy(c);const r=(await c.query('SELECT *,inventory_clock() now FROM guest_lifecycle WHERE context_id=$1 FOR UPDATE',[actor.contextId])).rows[0];if(!r||r.revision!==revision)throw new HoldError('STALE_RECOVERY_SETTINGS',409);if(r.policy_version!==this.policy.version)throw new HoldError('GUEST_POLICY_CHANGED',409);
  const until=new Date(Math.min(r.absolute_at.getTime(),r.now.getTime()+milliseconds(this.policy.recoverySeconds)));if(until<=r.now)throw new HoldError('GUEST_CONTEXT_EXPIRED',401);
  await c.query('UPDATE guest_lifecycle SET recovery_hash=$2,recovery_until=$3,revision=revision+1,replay_hash=NULL,replay_request=NULL,replay_until=NULL WHERE context_id=$1',[actor.contextId,hash(code),until]);await c.query("INSERT INTO guest_security_audit(context_id,action) VALUES($1,'RECOVERY_ENROLLED')",[actor.contextId]);return {code,revision:r.revision+1,recoveryUntil:until};
 });}
 async recover(code:unknown,requestId:unknown){if(!recoverySecret(code))throw new HoldError('RECOVERY_UNAVAILABLE',401);flowId(requestId);return this.transaction(async c=>{
  // Same stock-write lock order as logout and the existing domain services. Never revive revoked contexts.
  await c.query('SELECT pg_advisory_xact_lock(71820600)');const digest=hash(code);
  const r=(await c.query('SELECT g.*,s.policy_version,s.absolute_at,s.recovery_hash,s.recovery_until,s.replay_hash,s.replay_request,s.replay_until FROM guest_lifecycle s JOIN guest_contexts g ON g.id=s.context_id WHERE s.recovery_hash=$1 OR s.replay_hash=$1 FOR UPDATE OF g,s',[digest])).rows[0];
  const now=(await c.query<{now:Date}>('SELECT inventory_clock() now')).rows[0]!.now;
  if(!r||r.revoked_at||r.absolute_at<=now||r.policy_version!==this.policy.version)throw new HoldError('RECOVERY_UNAVAILABLE',401);
  // Standard HMAC-SHA256 PRF creates a deterministic, purpose-separated opaque session token.
  // Only its hash is stored; a lost response can be reissued for the SAME recovery request.
  const token=createHmac('sha256',this.serverKey).update(JSON.stringify(['guest-recovery-session-v1',r.id,requestId,digest])).digest('base64url');
  if(r.replay_hash===digest){if(r.replay_request!==requestId||r.replay_until<=now||r.expires_at<=now||r.token_sha256!==hash(token))throw new HoldError('RECOVERY_UNAVAILABLE',401);return {token,expiresAt:r.expires_at,maxAgeSeconds:Math.max(1,Math.floor((r.expires_at.getTime()-now.getTime())/1000)),replayed:true};}
  if(r.recovery_until<=now)throw new HoldError('RECOVERY_UNAVAILABLE',401);
  const expiresAt=new Date(Math.min(r.absolute_at.getTime(),now.getTime()+milliseconds(this.policy.contextSeconds))),replayUntil=new Date(Math.min(expiresAt.getTime(),now.getTime()+milliseconds(this.policy.replaySeconds)));
  await c.query('UPDATE guest_contexts SET token_sha256=$2,expires_at=$3 WHERE id=$1',[r.id,hash(token),expiresAt]);
  await c.query('UPDATE guest_lifecycle SET recovery_hash=NULL,recovery_until=NULL,replay_hash=$2,replay_request=$3,replay_until=$4,revision=revision+1 WHERE context_id=$1',[r.id,digest,requestId,replayUntil]);await c.query("INSERT INTO guest_security_audit(context_id,action) VALUES($1,'CONTEXT_RECOVERED')",[r.id]);return {token,expiresAt,maxAgeSeconds:Math.max(1,Math.floor((expiresAt.getTime()-now.getTime())/1000)),replayed:false};
 });}
 /** Bounded supervised retention operation; never releases stock or erases contractual/audit records. */
 async retain(limit=100){if(!Number.isInteger(limit)||limit<1||limit>100)throw new HoldError('INVALID_RETENTION_BATCH',422);return this.transaction(async c=>{
  const rows=(await c.query(`SELECT g.id FROM guest_contexts g JOIN guest_lifecycle s ON s.context_id=g.id WHERE s.policy_version=$3 AND s.retained_at IS NULL AND s.absolute_at+($1*interval '1 second')<inventory_clock() ORDER BY g.id FOR UPDATE OF g,s SKIP LOCKED LIMIT $2`,[this.policy.retentionSeconds,limit,this.policy.version])).rows;
  let redacted=0;for(const {id} of rows){await c.query('UPDATE guest_lifecycle SET recovery_hash=NULL,recovery_until=NULL,replay_hash=NULL,replay_request=NULL,replay_until=NULL,retained_at=inventory_clock() WHERE context_id=$1',[id]);const n=(await c.query('UPDATE guest_drafts SET input=NULL,selection=NULL WHERE context_id=$1 AND preview_id IS NULL AND booking_id IS NULL AND (input IS NOT NULL OR selection IS NOT NULL)',[id])).rowCount??0;if(n){redacted+=n;await c.query("INSERT INTO guest_security_audit(context_id,action) VALUES($1,'DRAFT_REDACTED')",[id]);}}
  await c.query('DELETE FROM guest_rate_buckets WHERE bucket IN (SELECT bucket FROM guest_rate_buckets WHERE expires_at<inventory_clock() ORDER BY expires_at LIMIT $1)',[limit]);return {processed:rows.length,redacted,contractualDataDeleted:false};
 });}
}
