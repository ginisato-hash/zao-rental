'use client';
import {useStaffLocaleOr} from './staff-locale';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {st,type StaffKey,type StaffLocale} from './staff-i18n';
import {StaffSessionBoundary,invalidateStaffView} from './StaffSessionBoundary';
import {localStorageFlag} from './StaffInboxBell';

type Pref={emailEnabled:boolean;locale:StaffLocale;email:string};
/** Settings (bottom of the Booqable sidebar): own notification preferences and links to staff administration. */
import type {ShellAccess} from './StaffShell';
export function StaffSettings({locale:serverLocale,stamp,access}:{locale:StaffLocale;stamp:string;access:ShellAccess}){
 const locale=useStaffLocaleOr(serverLocale);
 const t=(k:StaffKey)=>st(locale,k);
 const [pref,setPref]=useState<Pref|null>(null),[draft,setDraft]=useState<{emailEnabled:boolean;locale:StaffLocale}|null>(null),[status,setStatus]=useState(''),[busy,setBusy]=useState(false),[failed,setFailed]=useState(false);
 const [alerts,setAlerts]=useState(false),[blocked,setBlocked]=useState(false);
 useEffect(()=>{let alive=true;(async()=>{try{const r=await fetch('/api/operations/inbox/preference',{cache:'no-store',headers:{'x-zao-session':stamp}});if(r.status===401){invalidateStaffView();return;}if(!r.ok)throw Error();const v=await r.json() as Pref;if(alive){setPref(v);setDraft({emailEnabled:v.emailEnabled,locale:v.locale});}}catch{if(alive)setFailed(true);}})();
  queueMicrotask(()=>{if(!alive)return;setAlerts(localStorageFlag()&&typeof Notification!=='undefined'&&Notification.permission==='granted');setBlocked(typeof Notification!=='undefined'&&Notification.permission==='denied');});return()=>{alive=false;};},[stamp]);
 async function save(){if(!draft||busy)return;setBusy(true);setStatus('');
  try{const r=await fetch('/api/operations/inbox/preference',{method:'POST',cache:'no-store',headers:{'content-type':'application/json','x-zao-session':stamp},body:JSON.stringify({requestKey:crypto.randomUUID(),input:draft})});
   if(r.status===401){invalidateStaffView();return;}if(!r.ok)throw Error();const v=await r.json() as Pref;setPref(v);setDraft({emailEnabled:v.emailEnabled,locale:v.locale});setStatus('saved');}
  catch{setStatus('saveFailed');}finally{setBusy(false);}}
 async function toggleAlerts(on:boolean){
  if(!on){try{localStorage.removeItem('zao-staff-browser-alerts');}catch{/* storage unavailable */}setAlerts(false);return;}
  if(typeof Notification==='undefined')return;const p=Notification.permission==='granted'?'granted':await Notification.requestPermission();
  setBlocked(p==='denied');if(p==='granted'){try{localStorage.setItem('zao-staff-browser-alerts','1');setAlerts(true);}catch{setAlerts(false);}}
 }
 return <StaffSessionBoundary stamp={stamp}><main>
  <h1>{t('settings')}</h1>
  <section className="sx-card" style={{padding:'20px 24px'}} aria-labelledby="sx-email">
   <h2 id="sx-email" style={{marginTop:0}}>{t('emailTitle')}</h2>
   {failed&&<p className="sx-alert" role="alert">{t('saveFailed')}</p>}
   {pref&&draft&&<div className="sx-form">
    <label className="sx-check"><input type="checkbox" checked={draft.emailEnabled} onChange={e=>setDraft(d=>({...d!,emailEnabled:e.target.checked}))}/>
     <span>{t('emailOn')}<br/><b>{pref.email}</b><p className="sx-help">{t('emailHelp')}</p></span></label>
    <div className="sx-field"><label htmlFor="sx-email-locale">{t('emailLocale')}</label>
     <select id="sx-email-locale" value={draft.locale} onChange={e=>setDraft(d=>({...d!,locale:e.target.value==='en'?'en':'ja'}))}><option value="ja">日本語</option><option value="en">English</option></select></div>
    <div><button type="button" className="sx-btn sx-btn--primary" disabled={busy||(draft.emailEnabled===pref.emailEnabled&&draft.locale===pref.locale)} onClick={()=>void save()}>{t('save')}</button></div>
    <p className="sx-status" role="status" aria-live="polite">{status&&t(status as 'saved'|'saveFailed')}</p>
   </div>}
  </section>
  <section className="sx-card" style={{padding:'20px 24px',marginTop:16}} aria-labelledby="sx-alerts">
   <h2 id="sx-alerts" style={{marginTop:0}}>{t('notifications')}</h2>
   <label className="sx-check"><input type="checkbox" checked={alerts} disabled={blocked} onChange={e=>void toggleAlerts(e.target.checked)}/><span>{t('browserAlerts')}<p className="sx-help">{blocked?t('browserBlocked'):t('browserAlertsHelp')}</p></span></label>
  </section>
  <section style={{marginTop:24}}><ul className="sx-links">
   {access.manageStaff&&<li><Link href="/staff/users">{t('staffUsers')}</Link></li>}
   <li><Link href="/staff/password">{t('password')}</Link></li>
   {access.priceEdit&&<li><Link href="/admin/prices">{t('prices')}</Link></li>}
   <li><Link href="/staff/content">{t('content')}</Link></li>
   {access.bookingView&&<li><Link href="/admin/notifications">{t('customerMail')}</Link></li>}
   {access.operationsView&&<li><Link href="/admin/ops">{t('opsConsole')}</Link></li>}
   {access.operationsView&&<li><Link href="/admin/launch">{t('launch')}</Link></li>}
  </ul></section>
 </main></StaffSessionBoundary>;
}
