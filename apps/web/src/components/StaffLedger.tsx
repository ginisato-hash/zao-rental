 'use client';
import {useMemo} from 'react';
import {LedgerWorkspace} from './ledger/LedgerWorkspace';
import {createHttpLedgerClient} from './ledger/client';
import {StaffSessionBoundary,invalidateStaffView} from './StaffSessionBoundary';
export function StaffLedger({stamp,canEdit,canEditGlobal,canManageStaff}:{stamp:string;canEdit:boolean;canEditGlobal:boolean;canManageStaff:boolean}){
 const client=useMemo(()=>createHttpLedgerClient(stamp,invalidateStaffView),[stamp]);
 async function logout(){invalidateStaffView();const channel=new BroadcastChannel('zao-rental-session');channel.postMessage('signing-out');channel.close();try{const r=await fetch('/api/auth/sign-out',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});if(r.ok)window.location.replace('/staff/login');}catch{/* Closed view stays closed on uncertain sign-out. */}}
 return <StaffSessionBoundary stamp={stamp}><div className="staff-toolbar"><span>開発用DB · {canEdit?'台帳の閲覧・編集':'台帳の閲覧のみ'}</span><nav><a href="/admin/inventory">棚卸・CSV投入</a><a href="/staff/rentals">貸出・返却</a><a href="/staff/amendments">変更・返金依頼</a><a href="/admin/prices">料金版</a><a href="/admin/notifications">予約通知</a><a href="/staff/transfers">店舗間移動</a><a href="/staff/recommendations">サイズ推薦</a> · <a href="/staff/quotes">見積へ</a> · <a href="/staff/holds">期間在庫・HOLD</a><a href="/staff/password">パスワード変更</a>{canManageStaff&&<a href="/staff/users">スタッフ管理</a>} <button onClick={()=>void logout()}>ログアウト</button></nav></div><LedgerWorkspace client={client} canEdit={canEdit} canEditGlobal={canEditGlobal}/></StaffSessionBoundary>;
}
