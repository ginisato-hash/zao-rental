 'use client';
import {useContext,useEffect,useState,type ReactNode} from 'react';
import {StaffLocaleContext} from './staff-locale';
export function invalidateStaffView(){window.dispatchEvent(new Event('zao-auth-ended'));}
/** One /api/session probe for callers that start within SESSION_PROBE_JOIN_MS of each other (several boundaries/checks mount together on one screen).
 *  This only collapses concurrent duplicates: there is no cache and no TTL, a later check always asks the server again, and the answer is never reused
 *  after it has arrived. The server still authorises every request; this changes how many identical probes a single screen sends. */
export const SESSION_PROBE_JOIN_MS=100;
type SessionAnswer={ok:boolean;body:{stamp?:string}};
let inflight:{startedAt:number;promise:Promise<SessionAnswer>}|null=null;
export function probeSession(now:()=>number=Date.now):Promise<SessionAnswer>{
 const t=now();
 if(inflight&&t-inflight.startedAt<SESSION_PROBE_JOIN_MS)return inflight.promise;
 const promise=fetch('/api/session',{cache:'no-store'}).then(async r=>({ok:r.ok,body:await r.json() as {stamp?:string}}));
 const mine={startedAt:t,promise};inflight=mine;
 const clear=()=>{if(inflight===mine)inflight=null;};promise.then(clear,clear);
 return promise;
}
/** BELL-RACE-01: a 401/403/409 answer to a request made with `stamp` ends the view only if `stamp` is still the browser's
 * current session (its access really ended) or there is no session at all. If another valid session has replaced it
 * (sign-in as someone else while the request was pending), the answer belongs to the old session: the view for the new
 * stamp is not ended here, and StaffSessionBoundary keeps verifying whichever stamp is shown. A failed check ends it. */
export async function endViewIfSessionIs(stamp:string){
 try{const {ok,body}=await probeSession();
  if(ok&&body.stamp&&body.stamp!==stamp)return;}catch{/* cannot tell: fail closed */}
 invalidateStaffView();
}
export function StaffSessionBoundary({stamp,children}:{stamp:string;children:ReactNode}){
 // DOC-01: 'ready' is bound to the stamp the server verified. When the stamp changes, the previous ready never shows the
 // children: they stay hidden until this stamp itself is confirmed.
 const [verified,setVerified]=useState<{stamp:string;state:'checking'|'ready'|'ended';wasReady:boolean}>({stamp,state:'checking',wasReady:false});
 const en=useContext(StaffLocaleContext)?.locale==='en';
 useEffect(()=>{
  const setState=(next:'checking'|'ready'|'ended')=>setVerified(v=>({stamp,state:next,wasReady:next==='ready'||(next==='checking'&&v.stamp===stamp&&v.wasReady)}));
  let alive=true,closed=false,generation=0;const channel=new BroadcastChannel('zao-rental-session');
  const end=()=>{closed=true;generation++;setState('ended');};
  async function check(hide=false){if(closed||!alive)return;const ticket=++generation;if(hide)setState('checking');
   try{const {ok,body}=await probeSession();if(!alive||closed||ticket!==generation)return;if(!ok||body.stamp!==stamp)end();else setState('ready');}catch{if(alive&&!closed&&ticket===generation)end();}
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
  // Re-verification (another tab opened, a pageshow, a visibility change) HIDES the screen but must not destroy it: the children stay mounted, so typed
 // text and requests in flight survive a check that succeeds. Anything not yet confirmed for THIS stamp (first load, a new stamp) still renders only the
 // placeholder and never the children, and a failed check unmounts them ('ended'), so the no-JS and stamp-change guarantees are unchanged.
 const kept=verified.stamp===stamp&&verified.wasReady;
 return <>{state!=='ready'&&<main><p role="status">{en?'Checking your session…':'セッションを確認中…'}</p></main>}{(state==='ready'||(state==='checking'&&kept))&&<div hidden={state!=='ready'} style={{display:state==='ready'?'contents':'none'}}>{children}</div>}</>;
}
