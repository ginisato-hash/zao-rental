 'use client';
import {useContext,useEffect,useState,type ReactNode} from 'react';
import {StaffLocaleContext} from './staff-locale';
export function invalidateStaffView(){window.dispatchEvent(new Event('zao-auth-ended'));}
export function StaffSessionBoundary({stamp,children}:{stamp:string;children:ReactNode}){
 // DOC-01: 'ready' is bound to the stamp the server verified. When the stamp changes, the previous ready never shows the
 // children: they stay hidden until this stamp itself is confirmed.
 const [verified,setVerified]=useState<{stamp:string;state:'checking'|'ready'|'ended'}>({stamp,state:'checking'});
 const en=useContext(StaffLocaleContext)?.locale==='en';
 useEffect(()=>{
  const setState=(next:'checking'|'ready'|'ended')=>setVerified({stamp,state:next});
  let alive=true,closed=false,generation=0;const channel=new BroadcastChannel('zao-rental-session');
  const end=()=>{closed=true;generation++;setState('ended');};
  async function check(hide=false){if(closed||!alive)return;const ticket=++generation;if(hide)setState('checking');
   try{const r=await fetch('/api/session',{cache:'no-store'});const body=await r.json();if(!alive||closed||ticket!==generation)return;if(!r.ok||body.stamp!==stamp)end();else setState('ready');}catch{if(alive&&!closed&&ticket===generation)end();}
  }
  const visibility=()=>{if(document.visibilityState==='hidden'){generation++;setState('checking');}else void check(true);};
  // Initial pageshow can arrive after hydration: recheck without remounting the form.
  // A BFCache restore must hide stale staff data until the server verifies the session.
  const hide=()=>{generation++;setState('checking');},show=(event:PageTransitionEvent)=>void check(event.persisted!==false);
  channel.onmessage=event=>{if(['logout','signing-out','password-changed'].includes(event.data))end();else void check(true);};
  document.addEventListener('visibilitychange',visibility);window.addEventListener('pagehide',hide);window.addEventListener('pageshow',show);window.addEventListener('zao-auth-ended',end);
  const timer=setInterval(()=>void check(),15000);void check();channel.postMessage('session-opened');
  return()=>{alive=false;clearInterval(timer);channel.close();document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',hide);window.removeEventListener('pageshow',show);window.removeEventListener('zao-auth-ended',end);};
 },[stamp]);

 const state=verified.stamp===stamp?verified.state:'checking';
 if(state==='ended')return <main><h1>{en?'Check your session':'セッションを確認してください'}</h1><p>{en?'This screen was closed because you signed out, the session expired or your permissions changed.':'ログアウト、期限切れ、または権限の変更により画面を閉じました。'}</p><a href="/staff/login">{en?'Go to sign-in':'ログイン画面へ'}</a> · <a href="/staff/logout">{en?'Confirm sign-out':'ログアウトを確認'}</a></main>;
 return state==='ready'?children:<main><p role="status">{en?'Checking your session…':'セッションを確認中…'}</p></main>;
}
