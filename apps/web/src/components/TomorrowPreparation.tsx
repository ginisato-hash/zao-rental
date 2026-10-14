'use client';
import {useEffect,useRef,useState} from 'react';
import {invalidateStaffView} from './StaffSessionBoundary';
import {storeDisplayName} from '../../../../packages/contracts/src/store-display';
import type {Profile} from '../../../../packages/contracts/src/recommendation';
type Row={bookingId:string;displayName:string;period:{startDate:string;slot:string};pickupStore:string;pickup:{equipmentPrepared:boolean};preparationMembers:{key:string;product:string;tier:string;profile:Profile|null}[]};
export function TomorrowPreparation({stamp,store,onOpen}:{stamp:string;store:string;onOpen:(id:string)=>void}){
 const [data,setData]=useState<{store:string;date:string;rows:Row[];nextCursor:string|null}|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(false),[en,setEn]=useState(false);
 const generation=useRef(0),t=(j:string,e:string)=>en?e:j;
 async function load(cursor:string|null=null){const g=++generation.current;
  try{const r=await fetch('/api/operations/manifest?store='+store+'&section=preparation&pageSize=50'+(cursor?'&cursor='+encodeURIComponent(cursor):''),{cache:'no-store',headers:{'x-zao-session':stamp}}),d=await r.json();
   if([401,403].includes(r.status)||d.error==='SESSION_CHANGED'){invalidateStaffView();return;}
   if(g!==generation.current)return;if(!r.ok)throw new Error();
   setData(old=>({...d,rows:cursor&&old?.store===store?[...old.rows,...d.rows]:d.rows}));
  }catch{if(g===generation.current)setError(true);}finally{if(g===generation.current)setBusy(false);}
 }
 // Updates inside load occur only after the asynchronous fetch settles.
 // eslint-disable-next-line react-hooks/set-state-in-effect
 useEffect(()=>{const tickets=generation;void load();return()=>{tickets.current++;};
 // Each store gets its own server-clock tomorrow snapshot. Discard superseded responses.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[store,stamp]);
 const current=data?.store===store?data:null;
 return <section className="staff-manifest tomorrow-preparation" aria-label={t('明日の準備','Tomorrow’s preparation')} lang={en?'en':'ja'}><div className="staff-section-head"><h2>{t('明日の準備','Tomorrow’s preparation')}</h2><button disabled={busy} onClick={()=>{setBusy(true);setError(false);void load();}}>{t('更新','Refresh')}</button><button onClick={()=>setEn(!en)}>{en?'日本語':'English'}</button></div>
  <p>{storeDisplayName(store)} · {current?.date??'…'} JST</p>
  {error&&<p role="alert">{t('読み込めませんでした。更新してください。','Could not load. Please refresh.')}</p>}
  {(busy||!current&&!error)&&<p role="status">{t('読み込んでいます…','Loading…')}</p>}
  <div className="staff-card-grid">{current?.rows.map(r=><article className="staff-card" key={r.bookingId}><div className="staff-card-head"><strong>{r.displayName}</strong><span className="staff-chip">{r.pickup.equipmentPrepared?t('準備完了','Ready'):t('未準備','Not prepared')}</span></div><p>{r.period.startDate} {r.period.slot==='PM'?'13:00':'08:30'} · {storeDisplayName(r.pickupStore)}</p>
   {r.preparationMembers.map((m,n)=><p key={m.key}>{t('利用者','Person')} {n+1} · {({SKI_SET:t('スキーセット','Ski Set'),SNOWBOARD_SET:t('スノーボードセット','Snowboard Set'),SINGLE:t('単品','Individual Items'),WEAR_SET:t('ウェア','Wear')} as Record<string,string>)[m.product]}{m.product==='SINGLE'?'':' · '+(m.tier==='PREMIUM'?'Premium':m.tier==='REGULAR'?'Regular':t('スタンダード','Standard'))}<br/>{[m.profile?.heightCm?m.profile.heightCm+' cm':null,m.profile?.ski?m.profile.ski.weightKg+' kg':null,m.profile?.footCm?m.profile.footCm+' cm':null].filter(Boolean).join(' / ')}</p>)}
   <button className="staff-card-primary" onClick={()=>onOpen(r.bookingId)}>{r.pickup.equipmentPrepared?t('準備内容を確認','Review preparation'):t('準備する','Prepare')}</button></article>)}</div>
  {current&&!current.rows.length&&!busy&&!error&&<p>{t('明日の準備対象はありません。','No bookings to prepare for tomorrow.')}</p>}
  {current?.nextCursor&&<button disabled={busy} onClick={()=>{setBusy(true);setError(false);void load(current.nextCursor);}}>{t('さらに読み込む','Load more')}</button>}
 </section>;
}
