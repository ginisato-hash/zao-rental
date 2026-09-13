import {randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {LedgerError,ledgerAccess,parseInput,parseResource,assertId,validateFilters,type Resource,type LedgerPrincipal,type LedgerFilters,type LedgerRecord,type LedgerDetail} from '../../../contracts/src/ledger';
const tables:Record<Resource,string>={models:'ledger_models',variants:'ledger_variants',assets:'ledger_assets',poles:'ledger_poles',bundles:'ledger_bundles'};
const columns:Record<string,string>={catalogSeason:'catalog_season',compatibleSports:'compatible_sports',code:'code',name:'name',brand:'brand',family:'family',modelId:'model_id',variantId:'variant_id',age:'age',tier:'tier',size:'size',storeId:'store_id',status:'status',quantity:'quantity',bslStatus:'bsl_status',bslMm:'bsl_mm',bslEvidence:'bsl_evidence',notes:'notes',sourceKind:'source_kind',sourceDocument:'source_document',sourceLocator:'source_locator'};
type Connection=Pick<PoolClient,'query'>;
function sanitized(error:unknown):never {
  if(error instanceof LedgerError)throw error;
  const code=typeof error==='object'&&error!==null&&'code' in error?error.code:undefined;
  if(code==='23505')throw new LedgerError('DUPLICATE_RECORD',409);
  if(code==='23503'||code==='23514'||code==='22P02')throw new LedgerError('CONSTRAINT_VIOLATION',422);
  throw new LedgerError('LEDGER_OPERATION_FAILED',500);
}
// Only a trusted server session resolver may supply principal. Tests inject identities here,
// never via a header, cookie, environment flag or production route.
export class LedgerService {
  private readonly scope;
  constructor(private readonly pool:Pool, private readonly principal:LedgerPrincipal|null,private readonly authorizeWrite:(client:PoolClient,stores:typeof this.scope,global:boolean)=>Promise<void>,private readonly reconcileStock:(resource:'assets'|'poles',id:string,version:number)=>Promise<void>) {this.scope=ledgerAccess(principal);if(typeof authorizeWrite!=='function')throw new LedgerError('WRITE_AUTHORITY_NOT_CONFIGURED',500);if(typeof reconcileStock!=='function')throw new LedgerError('STOCK_RECONCILIATION_NOT_CONFIGURED',500);}
  private checkStore(store:unknown) {if(typeof store==='string' && !this.scope.includes(store as typeof this.scope[number]))throw new LedgerError('FORBIDDEN',403);}
  private async transaction<T>(reason:string,fn:(client:PoolClient)=>Promise<T>):Promise<T> {
    ledgerAccess(this.principal,true);
    const client=await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout='1500ms'; SET LOCAL statement_timeout='5000ms'");
      await client.query("SELECT set_config('zao.actor',$1,true),set_config('zao.reason',$2,true)",[this.principal!.subject,reason]);
      const result=await fn(client);await client.query('COMMIT');return result;
    }catch(error){await client.query('ROLLBACK');sanitized(error);}
    finally{client.release();}
  }
  async list(resource:Resource,filters:LedgerFilters={}) {
    parseResource(resource);validateFilters(filters);this.checkStore(filters.storeId);
    const values:unknown[]=[resource,[...this.scope]];
    const clauses=["resource=$1","(NOT (data ? 'storeId') OR data->>'storeId'=ANY($2::text[]))"];
    for(const key of ['storeId','age','tier','status'] as const)if(filters[key]!==undefined){values.push(filters[key]);clauses.push(`data->>'${key}'=$${values.length}`);}
    if(filters.size!==undefined){values.push(filters.size);clauses.push(`ledger_size_key(data->>'size')=ledger_size_key($${values.length})`);}
    if(filters.sport){values.push(filters.sport);clauses.push(`CASE WHEN data->>'family' IN ('SKI','SKI_BOOT','POLE','SKI_SET') THEN 'SKI' WHEN data->>'family' IN ('SNOWBOARD','SNOWBOARD_BOOT','SNOWBOARD_SET') THEN 'SNOWBOARD' ELSE 'WEAR' END=$${values.length}`);}
    if(filters.q){values.push(filters.q);clauses.push(`position(lower($${values.length}) in lower(concat_ws(' ',data->>'name',data->>'code',data->>'size')))>0`);}
    const where=clauses.join(' AND ');
    // A single statement binds page and total to the same PostgreSQL snapshot.
    values.push(filters.offset??0);
    const result=await this.pool.query<{items:LedgerRecord[];total:number}>(`WITH selected AS (SELECT id,data FROM ledger_records WHERE ${where}) SELECT (SELECT count(*)::int FROM selected) AS total,coalesce((SELECT jsonb_agg(p.data ORDER BY p.id) FROM (SELECT id,data FROM selected ORDER BY id LIMIT 100 OFFSET $${values.length}) p),'[]'::jsonb) AS items`,values);
    return {...result.rows[0]!,quantityMeaning:'LEDGER_ONLY_NOT_RESERVABLE' as const};
  }
  private async detail(client:Connection,resource:Resource,id:string):Promise<LedgerDetail> {
    const result=await client.query<{data:LedgerRecord}>('SELECT data FROM ledger_records WHERE resource=$1 AND id=$2',[resource,id]);
    const row=result.rows[0]?.data;
    if(!row || (row.storeId&&!this.scope.includes(row.storeId)))throw new LedgerError('NOT_FOUND',404);
    const history=await client.query<LedgerDetail['history'][number]>(`SELECT action,actor,reason,(to_jsonb(occurred_at) #>> '{}') AS "occurredAt",before_data AS before,after_data AS after FROM ledger_history WHERE resource=$1 AND entity_id=$2 ORDER BY occurred_at,event_id`,[resource,id]);
    const locations=resource==='assets'?await client.query<LedgerDetail['locations'][number]>(`SELECT store_id AS "storeId",event,(to_jsonb(occurred_at) #>> '{}') AS "occurredAt" FROM ledger_locations WHERE asset_id=$1 ORDER BY occurred_at`,[id]):{rows:[]};
    return {...row,history:history.rows,locations:locations.rows};
  }
  async get(resource:Resource,id:string):Promise<LedgerDetail> {
    parseResource(resource);assertId(id);
    const client=await this.pool.connect();
    try {await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const result=await this.detail(client,resource,id);await client.query('COMMIT');return result;}
    catch(error){await client.query('ROLLBACK');sanitized(error);}finally{client.release();}
  }
  async create(resource:Resource,input:unknown):Promise<LedgerDetail> {
    parseResource(resource);ledgerAccess(this.principal,true);const data=parseInput(resource,'create',input);this.checkStore(data.storeId);
    return this.transaction('REGISTER',async client=>{
      // Statement triggers also take this lock; explicitly wait before final authorization.
      await client.query('SELECT pg_advisory_xact_lock(71820600)');
      await this.authorizeWrite(client,typeof data.storeId==='string'?[data.storeId as typeof this.scope[number]]:[],!['assets','poles'].includes(resource));
      const keys=Object.keys(data);const names=keys.map(k=>columns[k]!);const values=keys.map(k=>data[k]);
      if(resource==='assets'){names.push('initial_store_id');values.push(data.storeId);}
      const id=randomUUID();names.push('id');values.push(id);
      await client.query(`INSERT INTO ${tables[resource]} (${names.join(',')}) VALUES (${values.map((_,i)=>'$'+(i+1)).join(',')})`,values);
      return this.detail(client,resource,id);
    });
  }
  async update(resource:Resource,id:string,input:unknown):Promise<LedgerDetail> {
    parseResource(resource);ledgerAccess(this.principal,true);assertId(id);const data=parseInput(resource,'update',input);
    if((resource==='assets'||resource==='poles')&&('status' in data||'quantity' in data))await this.reconcileStock(resource,id,data.version as number);
    return this.transaction(data.reason as string,async client=>{
      // Scope belongs in the locking statement: forbidden stores must not be locked at all.
      const storeScoped=resource==='assets'||resource==='poles';
      if(storeScoped){
        const visible=await client.query(`SELECT id FROM ${tables[resource]} WHERE id=$1 AND store_id=ANY($2::text[])`,[id,[...this.scope]]);
        if(visible.rowCount!==1)throw new LedgerError('NOT_FOUND',404);
      }
      await client.query('SELECT pg_advisory_xact_lock(71820600)');
      const locked=await client.query(`SELECT id FROM ${tables[resource]} WHERE id=$1${storeScoped?' AND store_id=ANY($2::text[])':''} FOR UPDATE`,storeScoped?[id,[...this.scope]]:[id]);
      if(locked.rowCount!==1)throw new LedgerError('NOT_FOUND',404);
      const prior=await this.detail(client,resource,id);
      if(prior.version!==data.version)throw new LedgerError('STALE_VERSION',409);
      await this.authorizeWrite(client,prior.storeId?[prior.storeId]:[],!storeScoped);
      const keys=Object.keys(data).filter(k=>k!=='version'&&k!=='reason');const values=keys.map(k=>data[k]);values.push(id,data.version);
      const updated=await client.query(`UPDATE ${tables[resource]} SET ${keys.map((k,i)=>`${columns[k]}=$${i+1}`).join(',')} WHERE id=$${values.length-1} AND version=$${values.length}`,values);
      if(updated.rowCount!==1)throw new LedgerError('STALE_VERSION',409);
      return this.detail(client,resource,id);
    });
  }
}
