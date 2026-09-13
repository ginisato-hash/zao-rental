import type {PrivateImmutableObjectStore} from './storage-port';
import {createHash} from 'node:crypto';
import type {PhotoJob,PhotoJobStore} from './photo-job';
import type {Pool} from 'pg';
import {canonical} from '../../../contracts/src/hold';
import {loadStaff} from '../../../auth/src/staff-auth';
import {ContentInputError} from './bulk-plan';
import type {ContentRepository,ContentAuthority,ContentPermission,ContentWorkflowState} from './workflow';
export class StaffContentAuthority implements ContentAuthority{
 constructor(private auth:Pool,private content:Pool,private identity:{subject:string;sessionId:string}){}
 async assert(subject:string,permission:ContentPermission){if(subject!==this.identity.subject)throw new ContentInputError('CONTENT_FORBIDDEN');const p=await loadStaff(this.auth,subject);const session=(await this.auth.query('SELECT 1 FROM auth_session WHERE id=$1 AND "userId"=$2 AND "expiresAt">clock_timestamp()',[this.identity.sessionId,subject])).rowCount;
  if(!session||!p||(await this.content.query('SELECT 1 FROM content_staff_access WHERE staff_id=$1 AND permission=$2',[subject,permission])).rowCount!==1)throw new ContentInputError('CONTENT_FORBIDDEN');}
}
/** Executes the existing draft/bulk/photo/release contract against serialized PostgreSQL. */
export class PostgresContentRepository implements ContentRepository{
 constructor(private pool:Pool,private actor:string,private reauthorize?:()=>Promise<void>){}
 async transaction<T>(fn:(state:ContentWorkflowState)=>Promise<T>):Promise<T>{const c=await this.pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL lock_timeout='1500ms';SET LOCAL statement_timeout='5000ms'");await c.query('SELECT pg_advisory_xact_lock_shared(71820901,hashtext($1))',[this.actor]);const row=(await c.query('SELECT value,revision FROM content_workspace WHERE id=true FOR UPDATE')).rows[0];if(!row)throw new ContentInputError('CONTENT_WORKSPACE_UNINITIALIZED');const before=row.value as ContentWorkflowState,state=structuredClone(before);const result=await fn(state);await this.reauthorize?.();
  for(const key of ['audit','outbox'] as const)if(state[key].length<before[key].length||canonical(state[key].slice(0,before[key].length))!==canonical(before[key]))throw new ContentInputError('CONTENT_HISTORY_IMMUTABLE');
  if(canonical(state.catalog.revisions.slice(0,before.catalog.revisions.length))!==canonical(before.catalog.revisions))throw new ContentInputError('CONTENT_REVISION_IMMUTABLE');
  for(const revision of state.catalog.revisions.slice(before.catalog.revisions.length))await c.query('INSERT INTO content_revision_records VALUES($1,$2)',[revision.id,JSON.stringify(revision)]);
  for(const a of state.audit.slice(before.audit.length)){if(a.actor!==this.actor)throw new ContentInputError('CONTENT_ACTOR_MISMATCH');await c.query('INSERT INTO content_audit_records(actor,action,object_id,before_id,after_id) VALUES($1,$2,$3,$4,$5)',[a.actor,a.action,a.objectId,a.before,a.after]);}
  for(const o of state.outbox.slice(before.outbox.length))await c.query('INSERT INTO content_outbox VALUES($1,$2)',[o.releaseId,o.event]);
  if(state.catalog.current!==before.catalog.current){const rel=state.catalog.releases.find(r=>r.id===state.catalog.current)!;for(const offer of new Set(rel.entries.map(id=>state.catalog.revisions.find(r=>r.id===id)!.offerCode))){const ja=state.catalog.revisions.find(r=>rel.entries.includes(r.id)&&r.offerCode===offer&&r.locale==='ja'),en=state.catalog.revisions.find(r=>rel.entries.includes(r.id)&&r.offerCode===offer&&r.locale==='en');if(!ja||!en)continue;await c.query("UPDATE content_model_previews SET content=$2,translation_approved=true,state='PREVIEW_APPROVED',revision=revision+1 WHERE slug=$1",[offer,JSON.stringify({ja:ja.content,en:en.content})]);}}

  await c.query('UPDATE content_workspace SET value=$1,revision=revision+1 WHERE id=true',[JSON.stringify(state)]);await c.query('COMMIT');return result;
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
 async snapshot(){return (await this.pool.query('SELECT value FROM content_workspace WHERE id=true')).rows[0]?.value as ContentWorkflowState|undefined;}
}

// Private bytes are immutable and addressed by digest. Only released derivative paths
// are exposed by the separate public media handler, never originals or arbitrary files.
export class PostgresPhotoStore implements PhotoJobStore,PrivateImmutableObjectStore{
 constructor(private repo:PostgresContentRepository,private pool:Pool){}
 async transaction<T>(fn:(jobs:Record<string,PhotoJob>,context:{offers:readonly string[]})=>Promise<T>){return this.repo.transaction(async state=>{const record=state as ContentWorkflowState&{photoJobs?:Record<string,PhotoJob>};record.photoJobs??={};return fn(record.photoJobs,{offers:Object.keys(state.catalog.commercialRevisions)});});}
 async readPrivateObject(sha256:string){if(!/^[a-f0-9]{64}$/.test(sha256))throw new ContentInputError('PHOTO_DIGEST_MISMATCH');return (await this.pool.query('SELECT bytes FROM content_media_objects WHERE sha256=$1',[sha256])).rows[0]?.bytes as Buffer|undefined??null;}
 async putPrivateObject(sha256:string,bytes:Buffer){if(createHash('sha256').update(bytes).digest('hex')!==sha256)throw new ContentInputError('PHOTO_DIGEST_MISMATCH');await this.pool.query('INSERT INTO content_media_objects VALUES($1,$2) ON CONFLICT DO NOTHING',[sha256,bytes]);}
}
