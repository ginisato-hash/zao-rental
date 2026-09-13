import {HoldError} from './hold';
export const launchGateIds=['TAX','SALES_SEASON','COUPON','CLEANING','STORE_NAP','CANCEL_REFUND_COPY','LATE_PICKUP_COPY','MEDIA_RIGHTS','GUEST_POLICY','TRUSTED_INGRESS','SQUARE_SANDBOX','STORAGE','REAL_DEVICE','FIELD_CWV','BACKUP_RESTORE','MIGRATION_ROLLBACK','SECRET_ROTATION','ALERT_DELIVERY','PRIVACY_RETENTION','PUBLICATION_APPROVAL'] as const;
export type LaunchGateId=typeof launchGateIds[number];
export type GateEvidence={id:LaunchGateId;state:'OWNER_PENDING'|'EXTERNAL_PENDING'|'VERIFIED'|'FAILED';head:string;policyRevision:string;evidenceRef:string|null;verifiedAt:string|null;expiresAt:string|null};
/** Backend/deployment evidence input only. A passed checklist does not itself deploy or grant authority. */
export function launchReadiness(gates:GateEvidence[],head:string,policyRevision:string,now:Date){
 if(!/^[a-f0-9]{40}$/.test(head)||!policyRevision||!Number.isFinite(now.getTime())||new Set(gates.map(g=>g.id)).size!==gates.length||gates.some(g=>!launchGateIds.includes(g.id)))throw new HoldError('READINESS_INPUT_INVALID',422);
 const blocked=launchGateIds.filter(id=>{const g=gates.find(g=>g.id===id);return !g||g.state!=='VERIFIED'||g.head!==head||g.policyRevision!==policyRevision||!g.evidenceRef||!g.verifiedAt||!Number.isFinite(Date.parse(g.verifiedAt))||new Date(g.verifiedAt)>now||!g.expiresAt||!Number.isFinite(Date.parse(g.expiresAt))||new Date(g.expiresAt)<=now;});return {ready:blocked.length===0,blocked,deployPerformed:false,approvalGranted:false};
}
export function safeOperationalEvent(input:{operation:string;outcome:string;durationMs:number;requestId:string}){
 if(!['guest_recovery','guest_rate','payment_reconcile','media_read','import_validate','health','scan'].includes(input.operation)||!['ok','denied','unknown','failed'].includes(input.outcome)||!Number.isFinite(input.durationMs)||input.durationMs<0||!/^[a-f0-9-]{36}$/.test(input.requestId)||Object.keys(input).sort().join()!=='durationMs,operation,outcome,requestId')throw new HoldError('LOG_INPUT_REJECTED',422);return {...input};
}
export function webVital(input:{name:'LCP'|'INP'|'CLS';value:number;page:'landing'|'catalog'|'booking'|'staff';device:'mobile'|'tablet'|'desktop';source:'LAB'|'FIELD'}){
 if(Object.keys(input).sort().join()!=='device,name,page,source,value'||!['LCP','INP','CLS'].includes(input.name)||!Number.isFinite(input.value)||input.value<0||!['landing','catalog','booking','staff'].includes(input.page)||!['mobile','tablet','desktop'].includes(input.device)||!['LAB','FIELD'].includes(input.source))throw new HoldError('METRIC_INPUT_REJECTED',422);return {...input,unit:input.name==='CLS'?'score':'milliseconds'};
}
