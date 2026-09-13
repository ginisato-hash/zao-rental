export const productionGateIds=['MAIN_PROTECTION','FOUNDATION_CI','GUEST_POLICY','TRUSTED_INGRESS','BOOKING_RECOVERY','SQUARE_SANDBOX','SQUARE_WEBHOOK','SECRET_STORE','STORAGE_PROVIDER','CATALOG_IMPORT','REAL_DEVICE','FIELD_CWV','BACKUP_PITR','BACKUP_RESTORE','RPO_RTO','TAX','SALES_PERIOD','COUPON','CLEANING','NAP','LEGAL_COPY','MEDIA_RIGHTS','DOMAIN','DEPLOYMENT','SEARCH_CONSOLE','GBP','ZAO_OFFICIAL_LISTING'] as const;
export type ProductionGateId=typeof productionGateIds[number];
export type GateState='PASS'|'FAIL'|'OWNER_PENDING'|'EXTERNAL_PENDING'|'NOT_RUN';
export type PreflightFacts={head:string;tree:string;main:string|null;checkedAt:string;mainProtection?:{active:boolean;defaultBranch:boolean;prRequired:boolean;foundationRequired:boolean;strict:boolean;conversations:boolean;squashOnly:boolean;forcePushBlocked:boolean;noBypass:boolean;source:'GITHUB_READ_ONLY'};foundation?:{repository:string;workflow:string;event:string;head:string;base:string;checkout:string;tree:string;runId:number;attempt:number;conclusion:string;jobsSucceeded:boolean;source:'GITHUB_READ_ONLY'};guestPolicyApproved:boolean;independentCouponDisabled:boolean;offline:boolean;worktreeClean?:boolean};
/** Gate evaluation is evidence-specific. Documentation/fixture presence cannot supply
 * an external PASS. Missing external adapters stay pending; this is never an activation API. */
export function productionPreflight(f:PreflightFacts){
 if(!/^[a-f0-9]{40}$/.test(f.head)||!/^[a-f0-9]{40}$/.test(f.tree)||!Number.isFinite(Date.parse(f.checkedAt)))throw new Error('PREFLIGHT_INPUT_INVALID');
 const owner=new Set<ProductionGateId>(['TAX','SALES_PERIOD','CLEANING','NAP','LEGAL_COPY','MEDIA_RIGHTS','DOMAIN','DEPLOYMENT','CATALOG_IMPORT']);
 const gates=productionGateIds.map(id=>({id,state:(owner.has(id)?'OWNER_PENDING':'EXTERNAL_PENDING') as GateState,reason:'EXTERNAL_EVIDENCE_REQUIRED',evidenceKind:'NONE'}));
 const put=(id:ProductionGateId,state:GateState,reason:string,evidenceKind:string)=>Object.assign(gates.find(g=>g.id===id)!,{state,reason,evidenceKind});
 const p=f.mainProtection;
 put('MAIN_PROTECTION',p?(p.source==='GITHUB_READ_ONLY'&&(['active','defaultBranch','prRequired','foundationRequired','strict','conversations','squashOnly','forcePushBlocked','noBypass'] as const).every(k=>p[k]===true)?'PASS':'FAIL'):'NOT_RUN',p?'RULESET23161641_CHECKED':'GITHUB_PROOF_UNAVAILABLE','GITHUB_READ_ONLY');
 const c=f.foundation;
 put('FOUNDATION_CI',c?(f.worktreeClean===true&&c.source==='GITHUB_READ_ONLY'&&c.repository==='ginisato-hash/zao-rental'&&c.workflow==='.github/workflows/ci.yml'&&c.event==='pull_request'&&c.head===f.head&&c.base===f.main&&c.tree===f.tree&&/^[a-f0-9]{40}$/.test(c.checkout)&&Number.isSafeInteger(c.runId)&&c.runId>0&&Number.isSafeInteger(c.attempt)&&c.attempt>0&&c.conclusion==='success'&&c.jobsSucceeded?'PASS':'FAIL'):'NOT_RUN',c?'EXACT_HEAD_INTEGRATION_CHECKED':'EXACT_CI_UNAVAILABLE','GITHUB_READ_ONLY');
 put('GUEST_POLICY',f.guestPolicyApproved?'PASS':'OWNER_PENDING','P4_BALANCED_VALUES_ONLY_NOT_RUNTIME_ACTIVATION','OWNER_APPROVAL');
 put('COUPON',f.independentCouponDisabled?'PASS':'FAIL','INDEPENDENT_COUPON_DISABLED_EARLY_PAYMENT_RULE_UNCHANGED','OWNER_APPROVAL');
 put('BOOKING_RECOVERY','EXTERNAL_PENDING','LOCAL_READ_ONLY_RECOVERY_NOT_EMAIL_OR_IDENTITY_DELIVERY_ACCEPTANCE','LOCAL_ONLY');
 put('BACKUP_RESTORE','EXTERNAL_PENDING','COLD_LOCAL_DRILL_NOT_OFF_HOST_ENCRYPTED_PITR_RESTORE','LOCAL_ONLY');
 put('RPO_RTO','EXTERNAL_PENDING','OWNER_SELECTION_TARGETS_NOT_MEASURED_PROVIDER_SLA','OWNER_TARGET');
 return {schemaVersion:1,checkedAt:f.checkedAt,head:f.head,tree:f.tree,main:f.main,offline:f.offline,worktreeClean:f.worktreeClean===true,ready:gates.every(g=>g.state==='PASS'),productionActivation:false,externalRequestsPerformed:0,gates};
}
