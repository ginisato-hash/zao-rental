import {createHash} from 'node:crypto';
import {staffState,publicStamp} from './staff-runtime';
import {contentRuntime} from './public-runtime';
import {PostgresContentRepository,PostgresPhotoStore,StaffContentAuthority} from '../../../../packages/core/src/content/postgres';
import {ContentInputError} from '../../../../packages/core/src/content/bulk-plan';
import type {ContentWorkflowState,ContentPermission} from '../../../../packages/core/src/content/workflow';
import type {CatalogFact,planCatalogSources} from '../../../../packages/core/src/content/catalog-source';
type Extended=ContentWorkflowState&{catalogFacts?:CatalogFact[];catalogSources?:Record<string,ReturnType<typeof planCatalogSources>[number]>};
export async function contentSession(request:Request){const c=contentRuntime();if(!c)throw new ContentInputError('CONTENT_UNCONNECTED');const staff=await staffState(request.headers);if(staff.status!=='authorized')throw new ContentInputError('UNAUTHENTICATED');const subject=staff.principal.subject,stamp=publicStamp(staff.stamp);if(request.headers.get('x-zao-session')!==stamp)throw new ContentInputError('SESSION_CHANGED');
 const baseAuthority=new StaffContentAuthority(c.r.authPool,c.contentPool,{subject,sessionId:JSON.parse(staff.stamp)[0]});
 const authority={async assert(s:string,p:ContentPermission){const current=await staffState(request.headers);if(current.status!=='authorized'||publicStamp(current.stamp)!==stamp)throw new ContentInputError('CONTENT_FORBIDDEN');await baseAuthority.assert(s,p);}};
 const pg=new PostgresContentRepository(c.contentPool,subject,()=>authority.assert(subject,'CONTENT_EDIT'));
 const record=(state:Extended)=>({state,catalogFacts:state.catalogFacts??[],catalogSources:state.catalogSources??{}});
 const repo={transaction:pg.transaction.bind(pg),async read(){const s=await pg.snapshot();if(!s)throw new ContentInputError('CONTENT_WORKSPACE_UNINITIALIZED');return record(s);},async edit<T>(fn:(r:ReturnType<typeof record>)=>Promise<T>){return pg.transaction(async state=>{const r=record(state),result=await fn(r);Object.assign(state,{catalogFacts:r.catalogFacts,catalogSources:r.catalogSources});return result;});}};
 const photo=new PostgresPhotoStore(pg,c.contentPool);
 return {runtime:c.r,subject,stamp,repo,authority,photo,async readDerivative(sha:string){if(!/^[a-f0-9]{64}$/.test(sha))throw new ContentInputError('PHOTO_DIGEST');const b=(await c.contentPool.query('SELECT bytes FROM content_media_objects WHERE sha256=$1',[sha])).rows[0]?.bytes as Buffer|undefined;if(!b||createHash('sha256').update(b).digest('hex')!==sha)throw new ContentInputError('PHOTO_MISSING');return b;}};
}
