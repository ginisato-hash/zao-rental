'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import type {LedgerRecord,LedgerDetail,LedgerInput,LedgerFilters,Resource} from '../../../../../packages/contracts/src/ledger';
import {httpLedgerClient,type LedgerClient} from './client';
import './ledger.css';
const tabs:Record<Resource,string>={assets:'個体台帳',poles:'ポール数量',models:'商品モデル',variants:'サイズ・区分',bundles:'セット構成'};
const labels:Record<string,string>={IN_TRANSIT:'運搬中（店舗在庫ではありません）',RECEIVED_PENDING_INSPECTION:'受領済み・準備未完了',SKI:'スキー',SNOWBOARD:'ボード',SKI_BOOT:'スキーブーツ',SNOWBOARD_BOOT:'ボードブーツ',POLE:'ポール',WEAR:'ウェア（旧分類）',WEAR_JACKET:'ウェア上着',WEAR_PANTS:'ウェアパンツ',STANDARD:'Standard',SKI_SET:'スキーセット',SNOWBOARD_SET:'ボードセット',ADULT:'大人',KIDS:'子供',REGULAR:'Regular',PREMIUM:'Premium',MOUNTAIN_BASE:'Mountain Base',ONSEN_BASE:'Onsen Base',UNVERIFIED:'要確認',AVAILABLE:'点検済み',MAINTENANCE:'整備中',RETIRED:'使用終了',SYNTHETIC:'合成サンプル',RECORDED:'BSL記録あり',NOT_APPLICABLE:'対象外'};
const label=(value:string|undefined)=>value?labels[value]??value:'—';
const errors:Record<string,string>={AUTHENTICATION_REQUIRED:'認証が必要です。',FORBIDDEN:'この操作の権限がありません。',STORE_SCOPE_REQUIRED:'担当店舗が設定されていません。',STALE_VERSION:'他の更新がありました。詳細を開き直してから更新してください。',INVALID_INPUT:'入力形式を確認してください。',CONSTRAINT_VIOLATION:'登録済みの参照先、BSL、数量を確認してください。',DUPLICATE_RECORD:'同じ識別子または出典が登録されています。',STORAGE_NOT_CONNECTED:'台帳の接続準備中です。',LEDGER_OPERATION_FAILED:'台帳を取得・保存できませんでした。'};
async function references(client:LedgerClient,resource:'models'|'variants'){const items:LedgerRecord[]=[];for(let offset=0;;offset+=100){const page=await client.list(resource,{offset});items.push(...page.items);if(!page.items.length||offset+100>=page.total)return items;}}
const message=(error:unknown)=>errors[error instanceof Error?error.message:'']??'処理を完了できませんでした。';
export function LedgerWorkspace({client=httpLedgerClient,canEdit=false,canEditGlobal=true,testNotice=false}:{client?:LedgerClient;canEdit?:boolean;canEditGlobal?:boolean;testNotice?:boolean}){
 const selection=useRef(0);
 useEffect(()=>()=>{selection.current++;},[]);
 const [resource,setResource]=useState<Resource>('assets');const editable=canEdit&&(canEditGlobal||resource==='assets'||resource==='poles');const [filters,setFilters]=useState<LedgerFilters>({});
 const [page,setPage]=useState<{items:LedgerRecord[];total:number}>({items:[],total:0});const [ready,setReady]=useState(false);
 const [detail,setDetail]=useState<LedgerDetail|null>(null);const [error,setError]=useState('');
 const [form,setForm]=useState<'create'|'update'|null>(null);const [models,setModels]=useState<LedgerRecord[]>([]);const [variants,setVariants]=useState<LedgerRecord[]>([]);
 const load=useCallback(async(token:number)=>{const result=await client.list(resource,filters);if(token===selection.current){setPage(result);setReady(true);}},[client,resource,filters]);
 useEffect(()=>{let active=true;client.list(resource,filters).then(result=>{if(active){setPage(result);setReady(true);}}).catch(e=>{if(active)setError(message(e));});return()=>{active=false;};},[client,resource,filters]);
 useEffect(()=>{let active=true;Promise.all([references(client,'models'),references(client,'variants')]).then(([m,v])=>{if(active){setModels(m);setVariants(v);}}).catch(e=>{if(active)setError(message(e));});return()=>{active=false;};},[client]);
 function changeTab(next:Resource){selection.current++;setResource(next);setFilters({});setDetail(null);setForm(null);setError('');setReady(false);setPage({items:[],total:0});}
 function filter(key:keyof LedgerFilters,value:string){selection.current++;setFilters(previous=>{const next={...previous,offset:0};if(value)Object.assign(next,{[key]:value});else delete next[key];return next;});setDetail(null);setForm(null);setError('');setReady(false);setPage({items:[],total:0});}
 async function open(row:LedgerRecord){const token=++selection.current;setDetail(null);setForm(null);try{const result=await client.get(resource,row.id);if(token===selection.current){setDetail(result);setError('');}}catch(e){if(token===selection.current)setError(message(e));}}
 async function save(input:LedgerInput){
   const token=selection.current;
   const result=form==='update'&&detail?await client.update(resource,detail.id,input):await client.create(resource,input);
   if(token!==selection.current)return;
   setDetail(result);setForm(null);setError('');await load(token);
   const [m,v]=await Promise.all([references(client,'models'),references(client,'variants')]);if(token===selection.current){setModels(m);setVariants(v);}
 }
 return <main className="ledger-shell">
  <header className="ledger-header"><div><p className="ledger-kicker">ZAO RENTAL / INVENTORY REGISTER</p><h1>道具の台帳</h1><p className="ledger-lead">商品と、ひとつずつの道具を記録する。</p></div><span className="ledger-pill">台帳 · 予約可否は未判定</span></header>
  <div className="ledger-notice">{testNotice?'合成サンプルを使った画面テストです。実スタッフのログイン・実在庫ではありません。':'台帳数量は予約可能数ではありません。期間・店舗を通した空き状況は、まだ判定しません。'}</div>
  <nav className="ledger-tabs" aria-label="台帳の種類">{(Object.keys(tabs) as Resource[]).map(key=><button key={key} aria-current={resource===key?'page':undefined} onClick={()=>changeTab(key)}>{tabs[key]}</button>)}</nav>
  <div className="ledger-workspace">
   <section className="ledger-list" aria-label={tabs[resource]}>
    <div className="ledger-section-head"><div><h2>{tabs[resource]}</h2><p>{ready?`${page.total} 件の台帳記録`:'読み込み中'}{resource==='poles'?' / 数量単位：ペア（2本）':''}</p></div>{editable&&<button className="ledger-primary" onClick={()=>{selection.current++;setForm('create');setDetail(null);setError('');}}>＋ 登録</button>}</div>
    <div className="ledger-filters">
     <label>検索<input placeholder="モデル名・ID" value={filters.q??''} onChange={e=>filter('q',e.target.value)}/></label>
     {(resource==='assets'||resource==='poles')&&<label>店舗<select value={filters.storeId??''} onChange={e=>filter('storeId',e.target.value)}><option value="">担当店舗すべて</option>{['MOUNTAIN_BASE','ONSEN_BASE'].map(s=><option key={s} value={s}>{label(s)}</option>)}</select></label>}
     <label>競技<select value={filters.sport??''} onChange={e=>filter('sport',e.target.value)}><option value="">すべて</option>{['SKI','SNOWBOARD','WEAR'].map(s=><option key={s} value={s}>{label(s)}</option>)}</select></label>
     {resource!=='models'&&<><label>年齢区分<select value={filters.age??''} onChange={e=>filter('age',e.target.value)}><option value="">すべて</option><option value="ADULT">大人</option><option value="KIDS">子供</option></select></label><label>クラス<select value={filters.tier??''} onChange={e=>filter('tier',e.target.value)}><option value="">すべて</option><option>REGULAR</option><option>PREMIUM</option></select></label></>}
     {resource!=='models'&&resource!=='bundles'&&<label>サイズ<input placeholder="例：160 cm" value={filters.size??''} onChange={e=>filter('size',e.target.value)}/></label>}
     {(resource==='assets'||resource==='poles')&&<label>状態<select value={filters.status??''} onChange={e=>filter('status',e.target.value)}><option value="">すべて</option>{['UNVERIFIED','AVAILABLE','MAINTENANCE','RETIRED'].map(s=><option key={s} value={s}>{label(s)}</option>)}</select></label>}
    </div>
    {error&&<p role="alert" className="ledger-error">{error}</p>}
    {form&&<LedgerForm key={`${resource}-${form}-${detail?.id??'new'}`} resource={resource} original={form==='update'?detail:null} models={models} variants={variants} onSave={save} onClose={()=>setForm(null)}/>}
    <div className="ledger-table-wrap"><table><thead><tr><th>道具・商品</th><th>区分 / サイズ</th><th>{resource==='poles'?'台帳数量':'管理単位'}</th><th>店舗 / 状態</th><th>詳細</th></tr></thead><tbody>{page.items.map(row=><tr key={row.id}><td><strong>{row.name}</strong><span>{label(row.family)} · {label(row.sourceKind)}</span></td><td>{label(row.age)} / {label(row.tier)}<span>{row.size??'—'}</span></td><td>{resource==='assets'?`1 ${row.unit==='BOARD'?'枚':'組'}`:resource==='poles'?`${row.quantity} ペア`:resource==='bundles'?'構成定義のみ':'マスター'}<span>{row.family==='SKI'&&resource==='assets'?'左右ラベル2枚・1 Asset':row.bslStatus==='UNVERIFIED'?'BSL要確認':resource==='bundles'?'物理在庫を増やしません':''}</span></td><td>{label(row.custody??row.storeId)}<span className="ledger-status">{label(row.status)}</span></td><td><button aria-label={`詳細：${row.name} ${row.size??row.code}`} onClick={()=>void open(row)}>見る ↗</button></td></tr>)}</tbody></table></div>
    {ready&&page.items.length===0&&<p className="ledger-empty">条件に一致する台帳記録がありません。別区分の在庫への置換はしません。</p>}
    <div className="ledger-page"><button disabled={!(filters.offset??0)} onClick={()=>{selection.current++;setDetail(null);setForm(null);setFilters({...filters,offset:Math.max(0,(filters.offset??0)-100)});}}>前の100件</button><span>最大100件ずつ表示</span><button disabled={(filters.offset??0)+100>=page.total} onClick={()=>{selection.current++;setDetail(null);setForm(null);setFilters({...filters,offset:(filters.offset??0)+100});}}>次の100件</button></div>
   </section>
   <aside className="ledger-detail" aria-label="台帳詳細">{detail?<><p className="ledger-kicker">REGISTER DETAIL</p><h2>{detail.name}</h2><span className="ledger-pill">{label(detail.sourceKind)}</span><dl><dt>不変のID</dt><dd className="ledger-id">{detail.id}</dd><dt>区分・サイズ</dt><dd>{label(detail.age)} / {label(detail.tier)} / {detail.size??'—'}</dd>{detail.storeId&&<><dt>所在地・受領状態</dt><dd>{label(detail.custody??detail.storeId)}<small>店舗移動は基本編集の対象外</small></dd></>}{detail.resource==='assets'&&<><dt>管理単位</dt><dd>{detail.unit==='BOARD'?'1枚 = 1 Asset':'左右1組 = 1 Asset'}<small>同じIDのラベル：{detail.labelCopies}枚</small></dd><dt>スキー用BSL</dt><dd><span>{detail.bslStatus==='UNVERIFIED'?'要確認・未記録':detail.bslStatus==='RECORDED'?`${detail.bslMm} mm`:'対象外'}</span><small>{detail.bslEvidence||'靴サイズからの推測・DIN計算は行いません'}</small></dd></>}{detail.resource==='poles'&&<><dt>台帳数量</dt><dd>{detail.quantity} ペア（1ペア＝2本）</dd></>}<dt>出典</dt><dd>{detail.sourceDocument}<small>{detail.sourceLocator}</small></dd><dt>備考</dt><dd>{detail.notes||'—'}</dd></dl>{detail.components&&<div className="ledger-components">{detail.components.map(c=><p key={c.family}>{label(c.family)} × {c.quantity} {c.unit==='BOARD'?'枚':'ペア'}</p>)}<small>同じ年齢区分・クラスの構成条件です。予約確保は行いません。</small></div>}{editable&&<button className="ledger-primary" onClick={()=>setForm('update')}>基本情報を更新</button>}<h3>登録・更新履歴</h3><ol className="ledger-history">{detail.history.map((h,i)=><li key={i}><strong>{h.action==='REGISTER'?'登録':'更新'} · {h.reason}</strong><span>{new Date(h.occurredAt).toLocaleString('ja-JP')}</span></li>)}</ol>{detail.locations.map((h,i)=><p key={i} className="ledger-footnote">{h.event==='INITIAL_REGISTRATION'?'初期所属':'移動受領'}：{label(h.storeId)} / 履歴保持</p>)}</>:<><p className="ledger-kicker">ONE RECORD, ONE TOOL</p><h2>道具の履歴を、<br/>ここに。</h2><p>一覧の「見る」から、個体ID、出典、BSLの確認状況と変更履歴を開けます。</p><div className="ledger-rule">スキー左右のラベルは同じID。<br/>2枚貼っても、台帳は1ペアです。</div><p className="ledger-footnote">ウェアは上下・サイズ別の数量管理です。衣類の個体IDやQRは発行しません。実在庫の総数・内訳は未確認です。</p></>}</aside>
  </div><footer className="ledger-footer">台帳数量と予約可能数は異なります。開発用処理・本番未接続。</footer>
 </main>;
}
function LedgerForm({resource,original,models,variants,onSave,onClose}:{resource:Resource;original:LedgerDetail|null;models:LedgerRecord[];variants:LedgerRecord[];onSave:(input:LedgerInput)=>Promise<void>;onClose:()=>void}){
 const candidateVariants=variants.filter(v=>resource==='poles'?v.family==='POLE':!['POLE','WEAR','WEAR_JACKET','WEAR_PANTS'].includes(v.family));
 const [family,setFamily]=useState(original?.family??(resource==='poles'?'POLE':resource==='bundles'?'SKI_SET':resource==='variants'?models.find(m=>m.family!=='WEAR')?.family??'SKI':candidateVariants[0]?.family??'SKI'));
 const [bsl,setBsl]=useState(original?.bslStatus??(family==='SKI_BOOT'?'UNVERIFIED':'NOT_APPLICABLE'));
 const [error,setError]=useState('');const [saving,setSaving]=useState(false);
 const input=(name:string,title:string,defaultValue:string|number='',required=true,type='text')=><label>{title}<input name={name} defaultValue={defaultValue} required={required} type={type} {...(type==='number'?{step:1,min:0}:{})}/></label>;
 async function submit(event:React.FormEvent<HTMLFormElement>){event.preventDefault();if(saving)return;setSaving(true);setError('');const values:LedgerInput=Object.fromEntries(new FormData(event.currentTarget));
   if(original)values.version=original.version;
   if(values.quantity!==undefined)values.quantity=Number(values.quantity);
   if(resource==='assets'){values.bslStatus=family==='SKI_BOOT'?bsl:'NOT_APPLICABLE';values.bslMm=family==='SKI_BOOT'&&bsl==='RECORDED'?Number(values.bslMm):null;values.bslEvidence=family==='SKI_BOOT'&&bsl==='RECORDED'?values.bslEvidence:'';}
   if(values.catalogSeason==='')delete values.catalogSeason;
   if(!original&&['variants','assets'].includes(resource))values.family=family;
   if(!original&&resource==='variants'&&family.startsWith('WEAR_')){values.tier='STANDARD';values.compatibleSports=String(values.compatibleSports).split(',');}
   try{await onSave(values);}catch(e){setError(message(e));}finally{setSaving(false);}
 }
 return <section className="ledger-form" aria-label={original?'更新フォーム':'登録フォーム'}><div className="ledger-section-head"><h3>{original?'基本情報を更新':'台帳に登録'}</h3><button onClick={onClose} disabled={saving}>閉じる</button></div><form onSubmit={event=>void submit(event)}><div className="ledger-form-grid">
  {!original&&<>
   {(resource==='models'||resource==='bundles')&&input('code','商品コード')}
   {(resource==='models'||resource==='bundles')&&input('name','名称')}
   {resource==='models'&&<>{input('brand','ブランド / 製造元','',false)}{input('catalogSeason','シーズン（例2026/27・登録後固定）','',false)}</>}
   {(resource==='models'||resource==='bundles')&&<label>種別<select name="family" defaultValue={family}>{(resource==='models'?['SKI','SNOWBOARD','SKI_BOOT','SNOWBOARD_BOOT','POLE','WEAR_JACKET','WEAR_PANTS']:['SKI_SET','SNOWBOARD_SET']).map(v=><option key={v} value={v}>{label(v)}</option>)}</select></label>}
   {resource==='variants'&&<><label>商品モデル<select name="modelId" required onChange={e=>setFamily(models.find(m=>m.id===e.target.value)!.family)}>{models.filter(m=>m.family!=='WEAR').map(m=><option key={m.id} value={m.id}>{m.code} / {m.name}</option>)}</select></label>{input('size','サイズ（単位込み）')}</>}
   {(resource==='assets'||resource==='poles')&&<label>サイズ・区分<select name="variantId" required onChange={e=>{const next=candidateVariants.find(v=>v.id===e.target.value)!.family;setFamily(next);setBsl(next==='SKI_BOOT'?'UNVERIFIED':'NOT_APPLICABLE');}}>{candidateVariants.map(v=><option key={v.id} value={v.id}>{v.name} / {label(v.age)} / {label(v.tier)} / {v.size}</option>)}</select></label>}
   {(resource==='assets'||resource==='poles')&&<label>初期所属店舗<select name="storeId"><option value="MOUNTAIN_BASE">Mountain Base</option><option value="ONSEN_BASE">Onsen Base</option></select></label>}
   {(resource==='variants'||resource==='bundles')&&<><label>年齢区分<select name="age"><option value="ADULT">大人（13歳以上）</option><option value="KIDS">子供（13歳未満）</option></select></label><label>クラス<select name="tier">{family.startsWith('WEAR_')?<option value="STANDARD">Standard</option>:<><option value="REGULAR">Regular</option><option value="PREMIUM">Premium</option></>}</select></label></>}
  </>}
  {!original&&resource==='variants'&&family.startsWith('WEAR_')&&<label>ウェア用途<select name="compatibleSports"><option value="SKI,SNOWBOARD">スキー・ボード共用</option><option value="SKI">スキーのみ</option><option value="SNOWBOARD">ボードのみ</option></select></label>}
  {original&&(resource==='models'||resource==='bundles')&&input('name','名称',original.name)}
  {original&&resource==='models'&&input('brand','ブランド / 製造元',original.brand??'',false)}
  {(resource==='assets'||resource==='poles')&&<label>台帳状態<select name="status" defaultValue={original?.status??'UNVERIFIED'}>{['UNVERIFIED','AVAILABLE','MAINTENANCE','RETIRED'].map(v=><option key={v} value={v}>{label(v)}{v==='AVAILABLE'?'（予約可否未判定）':''}</option>)}</select></label>}
  {resource==='poles'&&input('quantity','数量（ペア / 1ペア＝2本）',original?.quantity??0,true,'number')}
  {resource==='assets'&&family==='SKI_BOOT'&&<><label>BSL確認状況<select value={bsl} onChange={e=>setBsl(e.target.value)}><option value="UNVERIFIED">要確認・未記録</option><option value="RECORDED">実物の値を記録</option></select></label>{bsl==='RECORDED'&&<>{input('bslMm','実物のBSL（mm）',original?.bslMm??'',true,'number')}{input('bslEvidence','BSL確認の出典',original?.bslEvidence??'')}</>}</>}
  {!original&&<><label>データ区分<select name="sourceKind"><option value="UNVERIFIED">未確認の登録資料</option><option value="SYNTHETIC">合成サンプル</option></select></label>{input('sourceDocument','出典文書')}{input('sourceLocator','出典の行・セル・記録キー')}</>}
  {input('notes','備考',original?.notes??'',false)}{original&&input('reason','更新理由')}
 </div><p className="ledger-footnote">ID・区分・サイズ・所属店舗・出典は登録後に基本編集できません。BSLは実物の値を記録し、靴サイズから推測しません。</p>{error&&<p role="alert" className="ledger-error">{error}</p>}<button className="ledger-primary" type="submit" disabled={saving}>{saving?'保存中…':original?'変更を保存':'登録を保存'}</button></form></section>;
}
