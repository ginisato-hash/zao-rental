 'use client';
import {useContext,useEffect,useState,type ReactNode} from 'react';
import {StaffLocaleContext} from './staff-locale';
export function invalidateStaffView(){window.dispatchEvent(new Event('zao-auth-ended'));}
/** One /api/session probe for callers that start within SESSION_PROBE_JOIN_MS of each other (several boundaries/checks mount together on one screen).
 *  This only collapses concurrent duplicates: there is no cache and no TTL, a later check always asks the server again, and the answer is never reused
 *  after it has arrived. The server still authorises every request; this changes how many identical probes a single screen sends. */
export const SESSION_PROBE_JOIN_MS=100;
/** A probe that gets no answer within this time is a TRANSIENT failure (the screen stays hidden and retries); it can never hang a check forever. */
export const PROBE_TIMEOUT_MS=10000;
type SessionAnswer={ok:boolean;status:number;body:{status?:string;stamp?:string}};
/** Epoch of the browser's auth state. Anything that can change which session the cookie belongs to (a sign-in/sign-out/password change in another tab,
 *  a page restore, a visibility change, an auth-ended event) bumps it, and a probe is only ever shared with probes of the SAME epoch: an answer to a request
 *  that left before such a change is never handed to a check that started after it. */
let epoch=0;
let inflight:{startedAt:number;epoch:number;promise:Promise<SessionAnswer>}|null=null;
export function bumpSessionEpoch(){epoch++;inflight=null;}
export function probeSession(now:()=>number=Date.now):Promise<SessionAnswer>{
 const t=now();
 if(inflight&&inflight.epoch===epoch&&t-inflight.startedAt<SESSION_PROBE_JOIN_MS)return inflight.promise;
 const ctl=typeof AbortController==='undefined'?null:new AbortController();const timer=ctl?setTimeout(()=>ctl.abort(),PROBE_TIMEOUT_MS):null;
 const promise=fetch('/api/session',{cache:'no-store',...(ctl?{signal:ctl.signal}:{})}).finally(()=>{if(timer)clearTimeout(timer);}).then(async r=>({ok:r.ok,status:r.status,body:await r.json() as {status?:string;stamp?:string}}));
 const mine={startedAt:t,epoch,promise};inflight=mine;
 const clear=()=>{if(inflight===mine)inflight=null;};promise.then(clear,clear);
 return promise;
}
/** What a probe answer means. Only an explicit "this session is not valid" answer is a real end: 401 anonymous, or 403 disabled/unregistered, from the
 *  session endpoint itself. Everything else that is not a verified match (network error, 5xx, 429, 408, a body that is not the session JSON) says NOTHING
 *  about the session: it is transient and must never end an unexpired 8-hour session. */
export type ProbeVerdict='MATCH'|'CHANGED'|'ENDED'|'TRANSIENT';
export function classifyProbe(a:SessionAnswer|null,stamp:string):ProbeVerdict{
 if(!a)return 'TRANSIENT';
 if(a.ok){if(a.body.stamp===stamp)return 'MATCH';return typeof a.body.stamp==='string'&&a.body.stamp?'CHANGED':'TRANSIENT';}
 if((a.status===401&&a.body.status==='anonymous')||(a.status===403&&(a.body.status==='disabled'||a.body.status==='unregistered')))return 'ENDED';
 return 'TRANSIENT';
}
/** Reconnect schedule (ms) after a transient failure: bounded exponential backoff, never a terminal state. */
export const RECONNECT_DELAYS_MS=[1000,2000,4000,8000,15000,30000] as const;
export const reconnectDelay=(attempt:number)=>RECONNECT_DELAYS_MS[Math.min(Math.max(attempt,0),RECONNECT_DELAYS_MS.length-1)]!;
/** BELL-RACE-01: a 401/403/409 answer to a request made with `stamp` ends the view only if `stamp` is still the browser's
 * current session (its access really ended) or there is no session at all. If another valid session has replaced it
 * (sign-in as someone else while the request was pending), the answer belongs to the old session: the view for the new
 * stamp is not ended here, and StaffSessionBoundary keeps verifying whichever stamp is shown. A failed check ends it. */
export async function endViewIfSessionIs(stamp:string){
 // The verdict belongs to the auth state it was asked in. If anything that can change the session (another tab signing in or out, a page restore, a
 // visibility change) happened while the probe was in flight, its answer is about the OLD state: it must not end a screen that now belongs to a newer valid
 // session. The boundary re-verifies instead.
 const startedIn=epoch;
 let verdict:ProbeVerdict='TRANSIENT';
 try{verdict=classifyProbe(await probeSession(),stamp);}catch{/* cannot tell */}
 if(epoch!==startedIn){window.dispatchEvent(new Event('zao-auth-recheck'));return;}
 if(verdict==='CHANGED')return;
 // A request answered 401/403 and the session endpoint cannot be reached or says nothing: do not destroy a possibly valid session. The boundary hides the
 // screen and re-verifies until it can tell (a real expiry then ends it).
 if(verdict==='TRANSIENT'||verdict==='MATCH'){window.dispatchEvent(new Event('zao-auth-recheck'));return;}
 invalidateStaffView();
}
export function StaffSessionBoundary({stamp,children}:{stamp:string;children:ReactNode}){
 // DOC-01: 'ready' is bound to the stamp the server verified. When the stamp changes, the previous ready never shows the
 // children: they stay hidden until this stamp itself is confirmed.
 const [verified,setVerified]=useState<{stamp:string;state:'checking'|'ready'|'ended';wasReady:boolean;offline:boolean}>({stamp,state:'checking',wasReady:false,offline:false});
 const en=useContext(StaffLocaleContext)?.locale==='en';
 useEffect(()=>{
  const setState=(next:'checking'|'ready'|'ended',offline=false)=>setVerified(v=>({stamp,state:next,offline,wasReady:next==='ready'||(next==='checking'&&v.stamp===stamp&&v.wasReady)}));
  let alive=true,closed=false,generation=0,attempts=0,retry:ReturnType<typeof setTimeout>|null=null;const channel=new BroadcastChannel('zao-rental-session');
  const end=()=>{closed=true;generation++;if(retry)clearTimeout(retry);setState('ended');};
  // The 8-hour login is the only lifetime: a screen ends only when the server SAYS the session is invalid (401 anonymous / 403 disabled), the permission stamp
  // or the account changed, or a tab signed out. A dropped connection, 5xx, 429 or unreadable answer proves nothing: the screen is hidden (nothing stale is
  // shown, nothing can be operated), the children stay mounted, and verification retries with backoff until the server can answer; then the same screen returns.
  async function check(hide=false){if(closed||!alive)return;const ticket=++generation;if(hide)setState('checking');
   let verdict:ProbeVerdict='TRANSIENT';
   try{verdict=classifyProbe(await probeSession(),stamp);}catch{verdict='TRANSIENT';}
   if(!alive||closed||ticket!==generation)return;
   if(verdict==='MATCH'){attempts=0;if(retry){clearTimeout(retry);retry=null;}setState('ready');return;}
   if(verdict==='TRANSIENT'){setState('checking',true);if(retry)clearTimeout(retry);retry=setTimeout(()=>{retry=null;void check();},reconnectDelay(attempts++));return;}
   end();
  }
  const visibility=()=>{if(document.visibilityState==='hidden'){generation++;setState('checking');}else{bumpSessionEpoch();void check(true);}};
  // Initial pageshow can arrive after hydration: recheck without remounting the form.
  // A BFCache restore must hide stale staff data until the server verifies the session.
  const hide=()=>{generation++;setState('checking');},show=(event:PageTransitionEvent)=>{if(event.persisted!==false)bumpSessionEpoch();void check(event.persisted!==false);};
  const recheck=()=>{bumpSessionEpoch();void check(true);};
  channel.onmessage=event=>{if(['logout','signing-out','password-changed'].includes(event.data))end();else{bumpSessionEpoch();void check(true);}};
  document.addEventListener('visibilitychange',visibility);window.addEventListener('pagehide',hide);window.addEventListener('pageshow',show);window.addEventListener('zao-auth-ended',end);window.addEventListener('zao-auth-recheck',recheck);
  const timer=setInterval(()=>{if(!retry)void check();},15000);void check();channel.postMessage('session-opened');
  return()=>{alive=false;clearInterval(timer);if(retry)clearTimeout(retry);channel.close();document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',hide);window.removeEventListener('pageshow',show);window.removeEventListener('zao-auth-ended',end);window.removeEventListener('zao-auth-recheck',recheck);}
 },[stamp]);

 const state=verified.stamp===stamp?verified.state:'checking';
 if(state==='ended')return <main><h1>{en?'Check your session':'セッションを確認してください'}</h1><p>{en?'This screen was closed because you signed out, the session expired or your permissions changed.':'ログアウト、期限切れ、または権限の変更により画面を閉じました。'}</p><a href="/staff/login">{en?'Go to sign-in':'ログイン画面へ'}</a> · <a href="/staff/logout">{en?'Confirm sign-out':'ログアウトを確認'}</a></main>;
  // Re-verification (another tab opened, a pageshow, a visibility change) HIDES the screen but must not destroy it: the children stay mounted, so typed
 // text and requests in flight survive a check that succeeds. Anything not yet confirmed for THIS stamp (first load, a new stamp) still renders only the
 // placeholder and never the children, and a failed check unmounts them ('ended'), so the no-JS and stamp-change guarantees are unchanged.
 const kept=verified.stamp===stamp&&verified.wasReady;
 return <>{state!=='ready'&&<main><p role="status">{verified.stamp===stamp&&verified.offline?(en?'Reconnecting… your session is kept; this screen returns when the connection is back.':'接続を確認しています。ログインは維持されています。接続が戻ると画面が元に戻ります。'):(en?'Checking your session…':'セッションを確認中…')}</p></main>}{(state==='ready'||(state==='checking'&&kept))&&<div hidden={state!=='ready'} style={{display:state==='ready'?'contents':'none'}}>{children}</div>}</>;
}
