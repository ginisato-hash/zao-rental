import {HoldError} from './hold';
import {exact} from './pricing';
/** Launch staging contracts. Nothing here may carry credential material: the manifest
 * describes what a connection will need, never how to authenticate it. */
export const manifestComponents=['NEON','SQUARE','SQUARE_WEBHOOK','R2','NOTIFICATION_PROVIDER','VERCEL','CUSTOM_DOMAIN','BACKUP_PITR'] as const;
/** Components that must be actively connected before opening. The rest may be disabled
 * deliberately, which is a decision rather than an omission. */
export const mandatoryComponents=['NEON','SQUARE','SQUARE_WEBHOOK','VERCEL','BACKUP_PITR'] as const;
export type ManifestComponent=typeof manifestComponents[number];
export const manifestEnvironments=['DEVELOPMENT','PREVIEW','PRODUCTION'] as const;
export const activationStates=['NOT_CONFIGURED','CONFIGURED','ACTIVATION_PENDING','ACTIVE','DISABLED'] as const;
export type ActivationState=typeof activationStates[number];
export type ManifestEntry={component:ManifestComponent;logicalName:string;environment:typeof manifestEnvironments[number];requiredRole:string;requiredCapabilities:string[];storeMapping:Record<string,string>|null;featureFlag:string|null;activationState:ActivationState};
const FORBIDDEN_KEY=/(password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|signing|credential|connection[_-]?string|dsn|uri|url|authorization|bearer|cookie|session)/i;
const SECRET_VALUE=/(^[a-z][a-z0-9+.-]*:\/\/)|(^(sq0|sk_|pk_|rk_|EAAA|ghp_|gho_|AKIA|ASIA))|(-----BEGIN)|(postgres(ql)?:\/\/)/i;
const NAME=/^[A-Za-z0-9][A-Za-z0-9 ._:-]{0,79}$/;
/** Refuses a key that names credential material and any value shaped like a secret or a
 * connection URI, wherever it appears in the structure. */
export function assertNoSecretMaterial(value:unknown,path='manifest'):void{
 if(value===null||value===undefined)return;
 if(typeof value==='string'){if(SECRET_VALUE.test(value)||value.length>200)throw new HoldError('MANIFEST_SECRET_REFUSED',422);return;}
 if(typeof value==='number'||typeof value==='boolean')return;
 if(Array.isArray(value)){for(const [i,v] of value.entries())assertNoSecretMaterial(v,path+'['+i+']');return;}
 if(typeof value!=='object')throw new HoldError('MANIFEST_SHAPE_INVALID',422);
 for(const [key,v] of Object.entries(value as Record<string,unknown>)){
  if(FORBIDDEN_KEY.test(key))throw new HoldError('MANIFEST_SECRET_REFUSED',422);
  assertNoSecretMaterial(v,path+'.'+key);
 }
}
export function manifestEntry(input:unknown):ManifestEntry{
 const e=exact(input,['component','logicalName','environment','requiredRole','requiredCapabilities','storeMapping','featureFlag','activationState']);
 assertNoSecretMaterial(e);
 if(!manifestComponents.includes(e.component as ManifestComponent)||typeof e.logicalName!=='string'||!NAME.test(e.logicalName)||!manifestEnvironments.includes(e.environment as never)||typeof e.requiredRole!=='string'||!NAME.test(e.requiredRole)||!Array.isArray(e.requiredCapabilities)||e.requiredCapabilities.length>20||e.requiredCapabilities.some(c=>typeof c!=='string'||!NAME.test(c))||!activationStates.includes(e.activationState as ActivationState))throw new HoldError('MANIFEST_ENTRY_INVALID',422);
 if(e.featureFlag!==null&&(typeof e.featureFlag!=='string'||!NAME.test(e.featureFlag)))throw new HoldError('MANIFEST_ENTRY_INVALID',422);
 if(e.storeMapping!==null){
  const m=e.storeMapping as Record<string,unknown>;
  if(typeof m!=='object'||Array.isArray(m)||Object.keys(m).some(k=>!['MOUNTAIN_BASE','ONSEN_BASE'].includes(k))||Object.values(m).some(v=>typeof v!=='string'||!NAME.test(v)))throw new HoldError('MANIFEST_ENTRY_INVALID',422);
 }
 return e as ManifestEntry;
}
/** The whole manifest plus what is still missing, so the gap can be shown without ever
 * naming a credential. Every component must appear exactly once. */
export function productionConfigManifest(input:unknown){
 if(!Array.isArray(input)||input.length!==manifestComponents.length)throw new HoldError('MANIFEST_SHAPE_INVALID',422);
 const entries=input.map(manifestEntry);
 if(new Set(entries.map(e=>e.component)).size!==manifestComponents.length)throw new HoldError('MANIFEST_SHAPE_INVALID',422);
 const required=(c:ManifestComponent)=>(mandatoryComponents as readonly string[]).includes(c);
 // DISABLED only settles an optional component; a mandatory one still counts as missing.
 const pending=entries.filter(e=>e.activationState!=='ACTIVE'&&(e.activationState!=='DISABLED'||required(e.component)));
 const disabledMandatory=entries.filter(e=>e.activationState==='DISABLED'&&required(e.component)).map(e=>e.component);
 return Object.freeze({entries,missing:pending.map(e=>({component:e.component,activationState:e.activationState,mandatory:required(e.component),requiredRole:e.requiredRole,requiredCapabilities:e.requiredCapabilities})),disabledMandatory,complete:pending.length===0,containsSecrets:false as const});
}
export const launchGateRows=['CODE','CI','DB_SCHEMA','REAL_DATA','PAYMENT','WEBHOOK','MEDIA','NOTIFICATION','BACKUP','FIELD_DEVICE','STAFF_REHEARSAL'] as const;
export type LaunchGateRow=typeof launchGateRows[number];
export const launchGateStates=['READY','PENDING','BLOCKED','NOT_RUN'] as const;
export type LaunchGateState=typeof launchGateStates[number];
/** Backup connection gate: safe metadata only, never a provider credential or a restore. */
export type BackupGateInput={backupEnabled:boolean;retentionDays:number|null;pitrEnabled:boolean;latestSuccessfulBackupAgeHours:number|null;restoreTargetIsolated:boolean};
export function backupConnectionGate(input:unknown):{state:LaunchGateState;reasons:string[]}{
 const b=exact(input,['backupEnabled','retentionDays','pitrEnabled','latestSuccessfulBackupAgeHours','restoreTargetIsolated']);
 assertNoSecretMaterial(b);
 if(typeof b.backupEnabled!=='boolean'||typeof b.pitrEnabled!=='boolean'||typeof b.restoreTargetIsolated!=='boolean'||(b.retentionDays!==null&&(!Number.isSafeInteger(b.retentionDays)||Number(b.retentionDays)<0||Number(b.retentionDays)>3650))||(b.latestSuccessfulBackupAgeHours!==null&&(!Number.isFinite(b.latestSuccessfulBackupAgeHours as number)||Number(b.latestSuccessfulBackupAgeHours)<0)))throw new HoldError('BACKUP_GATE_INVALID',422);
 const reasons:string[]=[];
 if(!b.backupEnabled)reasons.push('BACKUP_NOT_ENABLED');
 if(b.retentionDays===null||Number(b.retentionDays)<7)reasons.push('RETENTION_INSUFFICIENT');
 if(!b.pitrEnabled)reasons.push('PITR_NOT_ENABLED');
 if(b.latestSuccessfulBackupAgeHours===null)reasons.push('NO_SUCCESSFUL_BACKUP_OBSERVED');
 else if(Number(b.latestSuccessfulBackupAgeHours)>26)reasons.push('LATEST_BACKUP_TOO_OLD');
 if(!b.restoreTargetIsolated)reasons.push('RESTORE_TARGET_NOT_ISOLATED');
 // Nothing was connected, so an unconfigured provider is NOT_RUN rather than a failure.
 const unconfigured=!b.backupEnabled&&b.latestSuccessfulBackupAgeHours===null&&!b.pitrEnabled;
 return {state:unconfigured?'NOT_RUN':reasons.length?'BLOCKED':'READY',reasons};
}

export const mandatoryCategories=['DB','MIGRATIONS','STAFF_AUTH','GUEST','BOOKING_ACCESS','PAYMENT','WEBHOOK','BACKUP','APP'] as const;
export const stagingCategories=['APP','DB','MIGRATIONS','STAFF_AUTH','GUEST','BOOKING_ACCESS','PAYMENT','WEBHOOK','MEDIA','NOTIFICATION','BACKUP','FEATURE_FLAGS'] as const;
export type StagingCategory=typeof stagingCategories[number];
export const stagingStates=['READY','OFF','UNCONNECTED','CONFIGURED','CONFIGURED_ACTIVATION_PENDING','UNAVAILABLE'] as const;
export type StagingState=typeof stagingStates[number];
/** Consolidated launch staging preflight over the safe category states only. It reads no
 * Production credential and cannot: every value is a fixed enum, so nothing it returns can
 * carry a secret, a provider identifier, a host or an error body. */
export function launchStagingPreflight(input:unknown){
 const v=exact(input,[...stagingCategories]);
 assertNoSecretMaterial(v);
 for(const category of stagingCategories)if(!stagingStates.includes(v[category] as StagingState))throw new HoldError('STAGING_STATE_INVALID',422);
 const categories=stagingCategories.map(category=>({category,state:v[category] as StagingState}));
 const mandatory=(c:StagingCategory)=>(mandatoryCategories as readonly string[]).includes(c);
 const blocked=categories.filter(c=>c.state==='UNAVAILABLE').map(c=>c.category);
 const connectionPending=categories.filter(c=>['UNCONNECTED','CONFIGURED','CONFIGURED_ACTIVATION_PENDING'].includes(c.state)).map(c=>c.category);
 // A mandatory component switched OFF is not readiness, it is an unmet requirement.
 const disabledMandatory=categories.filter(c=>c.state==='OFF'&&mandatory(c.category)).map(c=>c.category);
 const unmet=[...new Set([...blocked,...connectionPending.filter(mandatory),...disabledMandatory])];
 return Object.freeze({categories,blocked,connectionPending,disabledMandatory,unmet,ready:unmet.length===0,readsProductionCredentials:false as const,productionOperations:0 as const});
}

/** Square connection acceptance over identity metadata only. No access token, signing key
 * or transport belongs here and none is accepted; this decides whether a future connection
 * is even eligible to be attempted. A Sandbox/Production mismatch always fails closed. */
export type SquareConnectionFacts={environment:'SANDBOX'|'PRODUCTION';applicationEnvironment:'SANDBOX'|'PRODUCTION';merchantId:string;currency:string;locationIds:Record<string,string>;webhookNotificationUrl:string;idempotencyScope:string;reconciliationLookupEnabled:boolean};
const MERCHANT=/^[A-Z0-9][A-Z0-9_-]{3,63}$/,LOCATION=/^[A-Z0-9][A-Z0-9_-]{3,63}$/;
export type SquareExpectedIdentity={merchantId:string;locationIds:Record<string,string>;webhookOrigin:string;webhookPath:string;currency:'JPY';environment:'PRODUCTION'|'SANDBOX';idempotencyScope:string};
/** Compares observed connection facts against the Owner-approved expected identity. Shape
 * alone is never acceptance: a different merchant, location, host or path is a failure even
 * when perfectly well formed. No credential is read or stored on either side. */
export function squareIdentityAcceptance(actual:unknown,expected:unknown){
 const shape=squareConnectionAcceptance(actual);
 const e=exact(expected,['merchantId','locationIds','webhookOrigin','webhookPath','currency','environment','idempotencyScope']);
 const {webhookOrigin:_o,webhookPath:_p,...scannable}=e as Record<string,unknown>;void _o;void _p;
 assertNoSecretMaterial(scannable);
 const f=actual as Record<string,unknown>,failures=[...shape.failures];
 if(f.merchantId!==e.merchantId)failures.push('MERCHANT_IDENTITY_UNEXPECTED');
 if(f.currency!==e.currency)failures.push('CURRENCY_UNEXPECTED');
 if(f.environment!==e.environment)failures.push('ENVIRONMENT_UNEXPECTED');
 if(f.idempotencyScope!==e.idempotencyScope)failures.push('IDEMPOTENCY_SCOPE_UNEXPECTED');
 const actualMap=(f.locationIds??{}) as Record<string,string>,expectedMap=(e.locationIds??{}) as Record<string,string>;
 const stores=[...new Set([...Object.keys(actualMap),...Object.keys(expectedMap)])];
 if(stores.some(store=>actualMap[store]!==expectedMap[store]))failures.push('LOCATION_IDENTITY_UNEXPECTED');
 let url:URL|undefined;try{url=new URL(String(f.webhookNotificationUrl));}catch{/* already reported by shape */}
 if(!url||url.origin!==e.webhookOrigin||url.pathname!==e.webhookPath)failures.push('WEBHOOK_BINDING_UNEXPECTED');
 return Object.freeze({ready:failures.length===0,failures:[...new Set(failures)],providerRequestsMade:0 as const,credentialsRead:false as const});
}
export function squareConnectionAcceptance(input:unknown){
 const f=exact(input,['environment','applicationEnvironment','merchantId','currency','locationIds','webhookNotificationUrl','idempotencyScope','reconciliationLookupEnabled']);
 // The notification URL is a real URL, so it is excluded from the secret scan and checked
 // explicitly below instead; everything else must still be free of credential material.
 const {webhookNotificationUrl:_notificationUrl,...scannable}=f as Record<string,unknown>;void _notificationUrl;
 assertNoSecretMaterial(scannable);
 const failures:string[]=[];
 const environments=['SANDBOX','PRODUCTION'];
 if(!environments.includes(f.environment as string)||!environments.includes(f.applicationEnvironment as string))failures.push('ENVIRONMENT_INVALID');
 // A Sandbox credential in a Production app, or the reverse, must never be usable.
 else if(f.environment!==f.applicationEnvironment)failures.push('ENVIRONMENT_MISMATCH_FAIL_CLOSED');
 if(typeof f.merchantId!=='string'||!MERCHANT.test(f.merchantId))failures.push('MERCHANT_IDENTITY_INVALID');
 if(f.currency!=='JPY')failures.push('CURRENCY_MUST_BE_JPY');
 const map=f.locationIds as Record<string,unknown>;
 if(!map||typeof map!=='object'||Array.isArray(map))failures.push('STORE_MAPPING_INVALID');
 else{
  const stores=['MOUNTAIN_BASE','ONSEN_BASE'],keys=Object.keys(map);
  if(keys.length!==stores.length||stores.some(s=>!keys.includes(s)))failures.push('STORE_MAPPING_INCOMPLETE');
  if(keys.some(k=>typeof map[k]!=='string'||!LOCATION.test(map[k] as string)))failures.push('LOCATION_IDENTITY_INVALID');
  else if(new Set(Object.values(map) as string[]).size!==keys.length)failures.push('LOCATION_MAPPING_AMBIGUOUS');
 }
 let url:URL|undefined;try{url=new URL(String(f.webhookNotificationUrl));}catch{/* reported below */}
 if(!url||url.protocol!=='https:'||url.search||url.hash||['localhost','127.0.0.1','::1'].includes(url.hostname)||url.username||url.password)failures.push('WEBHOOK_URL_INVALID');
 if(typeof f.idempotencyScope!=='string'||!NAME.test(f.idempotencyScope))failures.push('IDEMPOTENCY_SCOPE_INVALID');
 if(f.reconciliationLookupEnabled!==true)failures.push('GET_PAYMENT_RECONCILIATION_REQUIRED');
 return Object.freeze({ready:failures.length===0,failures,providerRequestsMade:0 as const,credentialsRead:false as const});
}
