export const DEMO_PATHS=Object.freeze(['apps/web/src/app/staff/page.tsx','tests/e2e/foundation.spec.ts']);
export type DemoLimits={codexCliStarts:number;claudeCliStarts:number;minutes:number;automaticMerge:boolean;extraCredits:boolean};
export function validateDemoLimits(limits:DemoLimits){
  if(limits.codexCliStarts!==2||limits.claudeCliStarts!==2||limits.minutes!==60||limits.automaticMerge!==false||limits.extraCredits!==false)throw new Error('DEMONSTRATION_LIMITS_CHANGED');
}
export function nextStartDecision(limits:DemoLimits,kind:'codex'|'claude',history:{kind:'codex'|'claude';status:'DONE'|'UNKNOWN'|'AUTH_ERROR'|'QUOTA_ERROR'|'CREDITS_ERROR'}[]){
  validateDemoLimits(limits);
  if(!['codex','claude'].includes(kind))throw new Error('UNAPPROVED_MODEL_KIND');
  if(history.some(x=>x.status!=='DONE'))return 'BLOCKED_RECONCILIATION_OR_AUTH_QUOTA' as const;
  return history.filter(x=>x.kind===kind).length>=2?'BLOCKED_CLI_START_LIMIT' as const:'PLAN_ONLY_WITHIN_LIMIT' as const;
}
export function implementationEnvironment(scratch:string){
  if(!scratch.startsWith('/')||scratch.includes('\0'))throw new Error('INVALID_RUN_SCRATCH');
  return {PATH:'/usr/bin:/bin',LANG:'C.UTF-8',TMPDIR:scratch};
}
export function outerBoundaryReadiness(availableTools:Record<string,string|null>){
  // Presence of a CLI alone is never proof of a provisioned, tested, per-run termination boundary.
  return {unattendedReady:false as const,state:'UNATTENDED_HOLD' as const,availableTools,required:'An owner-approved per-run outer job/VM boundary, tested against setsid/guardian loss; no shared control socket or host credentials mounted.'};
}
export function dispatchLive():never{throw new Error('LIVE_NOT_IMPLEMENTED_OR_AUTHORIZED_OUTER_BOUNDARY_UNAVAILABLE');}
