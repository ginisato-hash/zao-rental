import type {GroupNotificationWorker} from './notification-worker';
/** The group-notice lane of the production worker tick (migration 0064). One bounded, leased pass; nothing is sent unless ALL of these hold:
 *  - the Owner opened it: `limit` (PRODUCTION_WORKER_GROUP_NOTIFICATION_LIMIT, 1-20) is above 0 (unset = 0 = the lane does not even look at the outbox);
 *  - a ready group role pool and the approved mail binding exist (`worker` is non-null);
 *  - the tick's own deadline has not passed.
 * Delivery itself keeps the worker's contract: a durable lease per row, a provider idempotency key, UNKNOWN => lookup only, never re-sent, and a notice for a
 * state the group has already left is suppressed. Returns null when the lane is closed (nothing to report). */
export async function runGroupNotificationLane(worker:Pick<GroupNotificationWorker,'runBatch'>|null,limit:number,deadline:Date,now:()=>number=Date.now):Promise<{state:'UNCONNECTED'|'NOT_RUN'|'PROCESSED';processed:number}|null>{
 if(!Number.isSafeInteger(limit)||limit<0||limit>20)throw Error('NORMAL_WORKER_BATCH_REJECTED');
 if(limit===0)return null;
 if(!worker)return {state:'UNCONNECTED',processed:0};
 if(!(now()<deadline.getTime()))return {state:'NOT_RUN',processed:0};
 const r=await worker.runBatch(limit,deadline);
 return {state:r.state==='PROCESSED'?'PROCESSED':'UNCONNECTED',processed:r.processed};
}
