'use client';
import {useStaffLocale} from './staff-locale';
import {StaffSessionBoundary} from './StaffSessionBoundary';
import Link from 'next/link';
import {useRef,useState} from 'react';
type Row={row:string;state:string};
const LABEL:Record<string,string>={CODE:'アプリ',CI:'コード検証（CI）',DB_SCHEMA:'データベース',REAL_DATA:'実在庫データ',PAYMENT:'決済連携',WEBHOOK:'決済通知の受信',MEDIA:'メディア',NOTIFICATION:'予約通知',BACKUP:'バックアップ',FIELD_DEVICE:'実機確認',STAFF_REHEARSAL:'スタッフ通し確認'};
const STATE:Record<string,string>={READY:'準備済み',PENDING:'設定途中',BLOCKED:'要対応',NOT_RUN:'未実施'};
const LABEL_EN:Record<string,string>={CODE:'App',CI:'Code checks (CI)',DB_SCHEMA:'Database',REAL_DATA:'Real stock data',PAYMENT:'Payment connection',WEBHOOK:'Payment notices',MEDIA:'Media',NOTIFICATION:'Booking notifications',BACKUP:'Backups',FIELD_DEVICE:'Device checks',STAFF_REHEARSAL:'Staff rehearsal'};
const STATE_EN:Record<string,string>={READY:'Ready',PENDING:'In progress',BLOCKED:'Needs action',NOT_RUN:'Not run'};
export function LaunchGateView({stamp}:{stamp:string}){
 const __i18n=useStaffLocale(),en=__i18n.locale==='en',locale=__i18n.locale,t=(j:string,e:string)=>en?e:j,p=(j:string,e:string)=>[j,e] as const,pick=(m:string|readonly [string,string])=>typeof m==='string'?m:m[en?1:0];void en;void locale;void p;void pick;
 const [rows,setRows]=useState<Row[]>([]),[runId,setRunId]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState<string|readonly [string,string]>('');
 const active=useRef(false);
 async function load(){if(active.current)return;active.current=true;setBusy(true);
  try{const q=runId?'?runId='+encodeURIComponent(runId):'';const r=await fetch('/api/admin/launch'+q,{cache:'no-store',headers:{'x-zao-session':stamp}});
   if(!r.ok)throw Error();const body=await r.json() as {rows:Row[]};setRows(body.rows);setMessage('');
  }catch{setRows([]);setMessage(p('公開準備状況を取得できません。権限と接続を確認してください。','Could not load the launch status. Check your permissions and the connection.'));}finally{active.current=false;setBusy(false);}}
 return <StaffSessionBoundary stamp={stamp}><main><h1>{t('公開準備状況','Launch readiness')}</h1><nav><Link href="/admin/ops">{t('運用例外','Operations exceptions')}</Link></nav>
 <details><summary>{t('確認範囲と技術情報','Scope and technical details')}</summary>
 <label>{t('現場確認ID（任意）','Field check ID (optional)')}<input aria-label={t('現場確認ID','Field check ID')} value={runId} disabled={busy} onChange={e=>setRunId(e.target.value.trim())} /></label></details>
 <button disabled={busy} onClick={()=>void load()}>{t('読み込む','Load')}</button>
 {message&&<p role="status">{pick(message)}</p>}
 <table><caption>{t('各項目の状態','Status of each item')}</caption><thead><tr><th scope="col">{t('項目','Item')}</th><th scope="col">{t('状態','Status')}</th></tr></thead>
 <tbody>{rows.map(r=><tr key={r.row}><th scope="row">{(en?LABEL_EN:LABEL)[r.row]??t('その他の確認項目','Other checks')}</th><td>{(en?STATE_EN:STATE)[r.state]??t('要確認','Needs checking')}</td></tr>)}</tbody></table>
 </main></StaffSessionBoundary>;
}
