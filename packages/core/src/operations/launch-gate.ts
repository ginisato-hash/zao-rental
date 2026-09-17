import {migrationPlan} from '../../../db/src/migration-plan';
import {backupConnectionGate,launchGateRows,type LaunchGateRow,type LaunchGateState} from '../../../contracts/src/launch-staging';
import {FlowError,flowObject} from '../../../contracts/src/rental-flow';
import type {OperationsContext} from './context';
import {FieldAcceptance,summariseField,deviceScenarios,rehearsalScenarios} from './field-acceptance';
import {InventoryOperations} from './inventory-service';
/** Read-only launch gate. It reports what is already true and offers no action: nothing
 * here can activate Production, deploy, take a payment or accept a secret. Because it
 * aggregates both stores it requires explicit ALL scope. */
const COMPONENT:Record<string,LaunchGateState>={READY:'READY',CONFIGURED:'PENDING',CONFIGURED_ACTIVATION_PENDING:'PENDING',OFF:'NOT_RUN',UNCONNECTED:'NOT_RUN',UNAVAILABLE:'BLOCKED'};
const map=(value:unknown):LaunchGateState=>typeof value==='string'&&COMPONENT[value]?COMPONENT[value]!:'BLOCKED';
export class LaunchGate{
 constructor(private ctx:OperationsContext){}
 async status(input:unknown){
  const v=flowObject(input,['runId','components','backup']);
  if(v.runId!==null&&typeof v.runId!=='string')throw new FlowError('LAUNCH_GATE_INPUT_INVALID',422);
  // The gate is a cross-store view, so assigned-store staff may never read it.
  const principal=await this.ctx.authorize('OPERATIONS_VIEW');
  if(principal.scope!=='ALL')throw new FlowError('FORBIDDEN',403);
  const components=(v.components&&typeof v.components==='object'&&!Array.isArray(v.components)?v.components:{}) as Record<string,unknown>;
  const rows:Record<LaunchGateRow,LaunchGateState>={} as Record<LaunchGateRow,LaunchGateState>;
  const registry=(await this.ctx.pool.query<{id:string}>('SELECT id FROM foundation_migrations ORDER BY id')).rows.map(r=>r.id);
  rows.DB_SCHEMA=registry.length===migrationPlan.length&&registry.every((id,i)=>id===migrationPlan[i]!.id)?'READY':'BLOCKED';
  rows.CODE=map(components.APP);
  // CI evidence lives in GitHub, not in this database, so the gate never claims it.
  rows.CI='NOT_RUN';
  // Real stock is proved by an explicit acceptance receipt bound to a committed import,
  // never by how a source file happens to be named. A synthetic rehearsal has no receipt.
  const receipts=await new InventoryOperations(this.ctx).realDataAcceptance();
  // Drift in the underlying commit or a withdrawn approval retires the receipt.
  const accepted=receipts.filter(r=>r.commitPresent&&r.sourceMatches&&r.sourceApproved);
  const stores=new Set(accepted.flatMap(r=>r.stores));
  rows.REAL_DATA=accepted.length>0&&accepted.some(r=>r.acceptedAssets>0)?(stores.has('MOUNTAIN_BASE')&&stores.has('ONSEN_BASE')?'READY':'PENDING'):'NOT_RUN';
  rows.PAYMENT=map(components.PAYMENT_ADAPTER);
  // Webhook acceptance is independent of the payment adapter.
  rows.WEBHOOK=map(components.WEBHOOK);
  rows.MEDIA=map(components.MEDIA);rows.NOTIFICATION=map(components.NOTIFICATION);
  rows.BACKUP=v.backup===null?'NOT_RUN':backupConnectionGate(v.backup).state;
  const records=v.runId?await new FieldAcceptance(this.ctx).status(v.runId as string,'SYSTEM'):[];
  rows.FIELD_DEVICE=v.runId?summariseField(records,deviceScenarios):'NOT_RUN';
  rows.STAFF_REHEARSAL=v.runId?summariseField(records,rehearsalScenarios):'NOT_RUN';
  return {rows:launchGateRows.map(row=>({row,state:rows[row]})),readOnly:true as const,canActivateProduction:false as const,realDataReceipts:accepted.length};
 }
}
