import {HostedPreviewBoundaryError,hostedPreviewBoundaryStages} from '../../../../packages/auth/src/hosted-preview-config';
export const hostedPreviewStartupStages=[...hostedPreviewBoundaryStages,'DB_CONNECT_GUEST','DB_CONNECT_HOLD','DB_CONNECT_PRICING','DB_CONNECT_RECOMMENDATION','DB_CONNECT_CONTENT_READ','DB_CONNECT_AVATAR_READ','DB_IDENTITY','TLS','GUEST_SECURITY_INIT','AVATAR_SECURITY_INIT','R2_INIT','READY'] as const;
export type HostedPreviewStartupStage=typeof hostedPreviewStartupStages[number];
/** Retain only the fixed stage, never the original exception or its cause. */
export class HostedPreviewStartupError extends Error {
 constructor(readonly stage:HostedPreviewStartupStage){super('PHASE6_RUNTIME_UNAVAILABLE');}
}
export function hostedPreviewUnavailable(error:unknown){
 const stage=(error instanceof HostedPreviewStartupError||error instanceof HostedPreviewBoundaryError)&&hostedPreviewStartupStages.includes(error.stage)?error.stage:'UNCLASSIFIED';
 return Response.json({error:'GUEST_PREVIEW_UNAVAILABLE',stage},{status:503,headers:{'Cache-Control':'private, no-store','X-Robots-Tag':'noindex, nofollow'}});
}
