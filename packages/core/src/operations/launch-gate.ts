import {migrationPlan} from '../../../db/src/migration-plan';
import {backupConnectionGate,launchGateRows,type LaunchGateRow,type LaunchGateState} from '../../../contracts/src/launch-staging';
import {FlowError,flowObject} from '../../../contracts/src/rental-flow';
import type {OperationsContext} from './context';
import {FieldAcceptance,summariseField,deviceScenarios,rehearsalScenarios} from './field-acceptance';
/** Read-only launch gate. It reports what is already true and offers no action: nothing
 * here can activate Production, deploy, take a payment or accept a secret. */
const COMPONENT:Record<string,LaunchGateState>={READY:'READY',CONFIGURED:'PENDING',CONFIGURED_ACTIVATION_PENDING:'PENDING',OFF:'NOT_RUN',UNCONNECTED:'NOT_RUN',UNAVAILABLE:'BLOCKED'};
const map=(value:unknown):LaunchGateState=>typeof value==='string'&&COMPONENT[value]?COMPONENT[value]!:'BLOCKED';
export class LaunchGate{
 constructor(private ctx:OperationsContext){}
 async status(input:unknown){
  const v=flowObject(input,['runId','components','backup']);
  if(v.runId!==null&&typeof v.runId!=='string')throw new FlowError('LAUNCH_GATE_INPUT_INVALID',422);
  await this.ctx.authorize('OPERATIONS_VIEW');
  const components=(v.components&&typeof v.components==='object'&&!Array.isArray(v.components)?v.components:{}) as Record<string,unknown>;
  const rows:Record<LaunchGateRow,LaunchGateState>={} as Record<LaunchGateRow,LaunchGateState>;
  const registry=(await this.ctx.pool.query<{id:string}>('SELECT id FROM foundation_migrations ORDER BY id')).rows.map(r=>r.id);
  rows.DB_SCHEMA=registry.length===migrationPlan.length&&registry.every((id,i)=>id===migrationPlan[i]!.id)?'READY':'BLOCKED';
  rows.CODE=map(components.APP);
  // CI evidence lives in GitHub, not in this database, so the gate never claims it.
  rows.CI='NOT_RUN';
  // Fixture rows keep source_kind SYNTHETIC; a committed receipt import writes UNVERIFIED.
  // A source document still marked SYNTHETIC is a rehearsal, not real stock.
  const real=Number((await this.ctx.pool.query("SELECT count(*)::int n FROM ledger_assets WHERE source_kind<>'SYNTHETIC' AND source_document NOT LIKE 'SYNTHETIC%'")).rows[0].n);
  rows.REAL_DATA=real>0?'READY':'NOT_RUN';
  rows.PAYMENT=map(components.PAYMENT_ADAPTER);rows.WEBHOOK=map(components.PAYMENT_ADAPTER);
  rows.MEDIA=map(components.MEDIA);rows.NOTIFICATION=map(components.NOTIFICATION);
  rows.BACKUP=v.backup===null?'NOT_RUN':backupConnectionGate(v.backup).state;
  const records=v.runId?await new FieldAcceptance(this.ctx).status(v.runId as string):[];
  rows.FIELD_DEVICE=v.runId?summariseField(records,deviceScenarios):'NOT_RUN';
  rows.STAFF_REHEARSAL=v.runId?summariseField(records,rehearsalScenarios):'NOT_RUN';
  return {rows:launchGateRows.map(row=>({row,state:rows[row]})),readOnly:true as const,canActivateProduction:false as const,realInventoryRows:real};
 }
}
