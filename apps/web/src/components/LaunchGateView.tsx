'use client';
import {StaffSessionBoundary} from './StaffSessionBoundary';
import Link from 'next/link';
import {useRef,useState} from 'react';
type Row={row:string;state:string};
const LABEL:Record<string,string>={CODE:'アプリ',CI:'CI',DB_SCHEMA:'DBスキーマ',REAL_DATA:'実在庫データ',PAYMENT:'決済',WEBHOOK:'Webhook',MEDIA:'メディア',NOTIFICATION:'通知',BACKUP:'バックアップ',FIELD_DEVICE:'実機確認',STAFF_REHEARSAL:'スタッフ通し確認'};
const STATE:Record<string,string>={READY:'準備済み',PENDING:'設定途中',BLOCKED:'要対応',NOT_RUN:'未実施'};
export function LaunchGateView({stamp}:{stamp:string}){
 const [rows,setRows]=useState<Row[]>([]),[runId,setRunId]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const active=useRef(false);
 async function load(){if(active.current)return;active.current=true;setBusy(true);
  try{const q=runId?'?runId='+encodeURIComponent(runId):'';const r=await fetch('/api/admin/launch'+q,{cache:'no-store',headers:{'x-zao-session':stamp}});
   if(!r.ok)throw Error();const body=await r.json() as {rows:Row[]};setRows(body.rows);setMessage('');
  }catch{setRows([]);setMessage('公開準備状況を取得できません。権限と接続を確認してください。');}finally{active.current=false;setBusy(false);}}
 return <StaffSessionBoundary stamp={stamp}><main><h1>公開準備状況</h1><nav><Link href="/admin/ops">運用例外</Link></nav>
 <p>この画面は状態の確認だけを行います。ここから本番接続・デプロイ・決済・秘密情報の入力はできません。</p>
 <label>現場確認ID（任意）<input aria-label="現場確認ID" value={runId} disabled={busy} onChange={e=>setRunId(e.target.value.trim())} placeholder="00000000-0000-4000-8000-000000000000"/></label>
 <button disabled={busy} onClick={()=>void load()}>読み込む</button>
 {message&&<p role="status">{message}</p>}
 <table><caption>各項目の状態</caption><thead><tr><th scope="col">項目</th><th scope="col">状態</th></tr></thead>
 <tbody>{rows.map(r=><tr key={r.row}><th scope="row">{LABEL[r.row]??r.row}</th><td>{STATE[r.state]??r.state}</td></tr>)}</tbody></table>
 </main></StaffSessionBoundary>;
}
