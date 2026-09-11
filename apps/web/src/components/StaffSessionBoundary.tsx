 'use client';
import {useEffect,useState,type ReactNode} from 'react';
export function invalidateStaffView(){window.dispatchEvent(new Event('zao-auth-ended'));}
export function StaffSessionBoundary({stamp,children}:{stamp:string;children:ReactNode}){
 const [state,setState]=useState<'checking'|'ready'|'ended'>('checking');
 useEffect(()=>{
  let alive=true,closed=false,generation=0;const channel=new BroadcastChannel('zao-rental-session');
  const end=()=>{closed=true;generation++;setState('ended');};
  async function check(hide=false){if(closed||!alive)return;const ticket=++generation;if(hide)setState('checking');
   try{const r=await fetch('/api/session',{cache:'no-store'});const body=await r.json();if(!alive||closed||ticket!==generation)return;if(!r.ok||body.stamp!==stamp)end();else setState('ready');}catch{if(alive&&!closed&&ticket===generation)end();}
  }
  const visibility=()=>{if(document.visibilityState==='hidden'){generation++;setState('checking');}else void check(true);};
  const hide=()=>{generation++;setState('checking');},show=()=>void check(true);
  channel.onmessage=event=>{if(['logout','signing-out','password-changed'].includes(event.data))end();else void check(true);};
  document.addEventListener('visibilitychange',visibility);window.addEventListener('pagehide',hide);window.addEventListener('pageshow',show);window.addEventListener('zao-auth-ended',end);
  const timer=setInterval(()=>void check(),15000);void check();channel.postMessage('session-opened');
  return()=>{alive=false;clearInterval(timer);channel.close();document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',hide);window.removeEventListener('pageshow',show);window.removeEventListener('zao-auth-ended',end);};
 },[stamp]);
 if(state==='ended')return <main><h1>セッションを確認してください</h1><p>ログアウト、期限切れ、または権限の変更により画面を閉じました。</p><a href="/staff/login">ログイン画面へ</a> · <a href="/staff/logout">ログアウトを確認</a></main>;
 return state==='ready'?children:<main><p role="status">セッションを確認中…</p></main>;
}
