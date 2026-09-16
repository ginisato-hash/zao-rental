'use client';
import {useState} from 'react';
import type {InventoryOperations} from '../../../../packages/core/src/operations/inventory-service';
import {STOCK_IMPORT_HEADER_V2} from '../../../../packages/contracts/src/stock-import';
import {AssetQrInput} from './AssetQrInput';
import {StaffSessionBoundary} from './StaffSessionBoundary';
import {useOperationsRequest} from './useOperationsRequest';
import './holds.css';
import './operations.css';
type Workspace=Awaited<ReturnType<InventoryOperations['workspace']>>;
type Stocktake=Awaited<ReturnType<InventoryOperations['get']>>;
type Stage=Awaited<ReturnType<InventoryOperations['stageImport']>>;
export function InventoryOperationsWorkspace(p:{stamp:string;stores:string[];canEdit:boolean;canReconcile:boolean}){return <StaffSessionBoundary stamp={p.stamp}><Workspace {...p}/></StaffSessionBoundary>;}
function Workspace({stamp,stores,canEdit,canReconcile}:{stamp:string;stores:string[];canEdit:boolean;canReconcile:boolean}){
 const op=useOperationsRequest(stamp,'inventory'),[store,setStore]=useState(stores[0]??''),[workspace,setWorkspace]=useState<Workspace|null>(null),[stocktake,setStocktake]=useState<Stocktake|null>(null),[assets,setAssets]=useState<string[]>([]),[counts,setCounts]=useState<Record<string,number>>({}),[reason,setReason]=useState(''),[csv,setCsv]=useState(''),[stage,setStage]=useState<Stage|null>(null),[lastId,setLastId]=useState('');
 function openStocktake(s:Stocktake){setStocktake(s);setAssets(s.observations.assets);setCounts(s.observations.quantities);setStore(s.store_id);setLastId(s.id);}
 function refresh(){if(lastId)void op.load<Stocktake>('/api/operations/stocktake?id='+lastId,openStocktake);}
 return <main className="holds operations"><header><h1>棚卸・在庫投入</h1><nav><a href="/admin/assets">用品台帳・ラベル</a> · <a href="/staff/transfers">店舗間移動</a> · <a href="/staff/wear">ウェア</a> · <a href="/staff/rentals">貸出・返却</a></nav></header>
 <p>照合だけでは在庫を変更しません。所在不明は要確認、異なる店舗で見つかった用品は通常の移動・受領で処理します。</p><p role="status">{op.message}</p>
 {op.pending&&<button disabled={op.busy} onClick={()=>void op.send(op.pending!.path,null,()=>{setStage(null);setStocktake(null);},true)}>保存済みの同じ要求を照合</button>}
 <fieldset disabled={op.disabled}><legend>店舗</legend><label>対象店舗<select value={store} onChange={e=>{setStore(e.target.value);setStocktake(null);setWorkspace(null);}}>{stores.map(s=><option key={s}>{s}</option>)}</select></label><button onClick={()=>void op.load<Workspace>('/api/operations/inventory?store='+store,setWorkspace)}>店舗在庫を読み込む</button><button disabled={!canEdit} onClick={()=>void op.send<{id:string}>('/api/operations/stocktake-create',{store},r=>{setLastId(r.id);setStocktake(null);})}>棚卸を開始</button></fieldset>
 {lastId&&<p>棚卸ID: {lastId} <button disabled={op.busy} onClick={refresh}>棚卸を読み込む</button></p>}
 {workspace&&<section><h2>保存済み棚卸</h2>{workspace.stocktakes.map(s=><p key={s.id}><button disabled={op.disabled} onClick={()=>void op.load<Stocktake>('/api/operations/stocktake?id='+s.id,openStocktake)}>{s.id} · {s.state}</button></p>)}</section>}
 {stocktake&&<section><h2>棚卸の照合</h2><p>{stocktake.state} · revision {stocktake.revision}</p><AssetQrInput disabled={op.disabled||!canEdit} onAsset={async id=>setAssets(old=>old.includes(id)?old:[...old,id])}/><p>今回の読取: {assets.length}件（まだ保存されていません）</p><ul>{assets.map(id=><li key={id}>{id} <button disabled={op.disabled} onClick={()=>setAssets(a=>a.filter(x=>x!==id))}>読取を取り消す</button></li>)}</ul>
 <fieldset disabled={op.disabled||!canEdit}><legend>数量プールの実数</legend>{stocktake.baseline.quantities.map(q=><label key={q.id}>{q.kind==='POLES'?'ポール（PAIR）':'ウェア（枚）'} {q.id} · 台帳の店内数 {q.physical}<input type="number" min="0" max="1000000" value={counts[q.id]??''} onChange={e=>setCounts(c=>({...c,[q.id]:Number(e.target.value)}))}/></label>)}<button onClick={()=>void op.send<{id:string}>('/api/operations/stocktake-observe',{id:stocktake.id,expectedRevision:stocktake.revision,assets,quantities:counts},r=>{setLastId(r.id);setStocktake(null);})}>読取・数量を保存して差異確認へ</button></fieldset>
 <h3>保存済み差異</h3><p>不足 {stocktake.differences.missing.length} / 想定外 {stocktake.differences.unexpected.length}</p><ul>{stocktake.differences.quantities.filter(q=>q.difference!==0).map(q=><li key={q.id}>{q.kind} {q.id}: {q.counted===null?'未入力':`${q.physical} → ${q.counted}`}</li>)}</ul>
 <fieldset disabled={op.disabled||!canReconcile||stocktake.state!=='REVIEW_REQUIRED'}><legend>権限による差異確定</legend><p>不足用品を利用不可へ変更し、数量の確認済み差異を反映します。予約・貸出中・検品中の保護を破る変更は拒否されます。</p><label>理由（病歴等の詳細は記入しない）<input value={reason} maxLength={160} onChange={e=>setReason(e.target.value)}/></label><button disabled={!reason.trim()} onClick={()=>void op.send<{id:string}>('/api/operations/stocktake-reconcile',{id:stocktake.id,expectedRevision:stocktake.revision,reason},r=>{setLastId(r.id);setStocktake(null);})}>差異を確定する</button></fieldset></section>}
 <section><h2>CSV在庫投入</h2><p>最初にdry-runを保存し、未解決0件の内容だけ確定します。個体IDは明示し、不明なBSLは空欄にします。manufacturer_skuは正本カタログに無いため空欄。source_document / source_row は同じ受入れ元で固定してください。</p><button disabled={op.disabled} onClick={()=>{const url=URL.createObjectURL(new Blob([STOCK_IMPORT_HEADER_V2.join(',')+'\n'],{type:'text/csv'}));const a=document.createElement('a');a.href=url;a.download='zao-stock-template.csv';a.click();URL.revokeObjectURL(url);}}>CSVテンプレートを保存</button>
 <fieldset disabled={op.disabled||!canEdit}><legend>入力ファイル</legend><label>CSVファイル<input type="file" accept=".csv,text/csv" onChange={e=>{const f=e.target.files?.[0];setStage(null);if(f&&f.size<=2*1024*1024)void f.text().then(setCsv);else setCsv('');}}/></label><button disabled={!csv} onClick={()=>void op.send<Stage>('/api/operations/import-stage',{csv,sheet:'stock'},setStage)}>dry-runを保存</button></fieldset>
 {stage&&<section><p>dry-run: {stage.ready?'確定可能':'要修正'} · {stage.rows.length}行</p><ul>{stage.unresolved.map(x=><li key={x.row}>行{x.row}: {x.codes.join(', ')}</li>)}{stage.conflicts.map(x=><li key={x}>{x}: 既存個体IDと衝突</li>)}</ul><fieldset disabled={op.disabled||!canEdit||!stage.ready}><label>投入理由<input maxLength={160} value={reason} onChange={e=>setReason(e.target.value)}/></label><button disabled={!reason.trim()} onClick={()=>void op.send('/api/operations/import-commit',{id:stage.id,stageSha256:stage.stageSha256,reason},()=>{setStage(null);setCsv('');})}>検証済みの在庫を投入</button></fieldset></section>}</section>
 </main>;
}
