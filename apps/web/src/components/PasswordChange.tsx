'use client';
import {useEffect,useRef,useState} from 'react';
import {useStaffLocale} from './staff-locale';
import './staff-orders.css';

/** Change one's own password (every role). The existing API is unchanged: POST /api/auth/change-password with the
 * current and the new password; the server verifies the session and the current password (Argon2id), locks after
 * repeated failures and ends every session. The page adds what a person needs to do it right the first time: a
 * confirmation field, the length rule checked before sending, one request at a time, a specific error that keeps what
 * was typed, and a clear statement that every device signs in again afterwards. */
type Failure='mismatch'|'length'|'current'|'rejected'|'network'|'session';
export function PasswordChange(){
 const {locale}=useStaffLocale(),t=(j:string,e:string)=>locale==='en'?e:j;
 const [failure,setFailure]=useState<Failure|null>(null),[busy,setBusy]=useState(false),sending=useRef(false),done=useRef(false),alert=useRef<HTMLParagraphElement>(null);
 // After an error, focus moves to its message so keyboard and screen-reader users hear it (typed values stay).
 useEffect(()=>{if(failure)alert.current?.focus();},[failure]);
 const message:Record<Failure,string>={
  mismatch:t('新しいパスワードと確認用の入力が一致しません。','The new password and its confirmation do not match.'),
  length:t('新しいパスワードは15〜128文字にしてください。','Use 15 to 128 characters for the new password.'),
  // The server answers LOGIN_REJECTED both for a wrong/locked current password and for a new password the library refuses.
  current:t('変更できませんでした。現在のパスワードが正しいか、新しいパスワードが条件を満たすかを確認してください。失敗が続くと一時的にロックされます。','The password was not changed. Check the current password and that the new one meets the rule. Repeated failures lock the account for a while.'),
  rejected:t('このパスワードには変更できませんでした。別のパスワードにしてください。','This password could not be set. Choose a different one.'),
  network:t('通信できませんでした。もう一度お試しください。','Could not reach the server. Try again.'),
  session:t('ログインの有効期限が切れました。もう一度ログインしてから変更してください。','Your sign-in has ended. Sign in again, then change the password.'),
 };
 async function submit(event:React.FormEvent<HTMLFormElement>){
  event.preventDefault();if(sending.current)return;
  const d=new FormData(event.currentTarget),current=String(d.get('currentPassword')??''),next=String(d.get('newPassword')??''),confirm=String(d.get('confirmPassword')??'');
  if(next.length<15||next.length>128){setFailure('length');return;}if(next!==confirm){setFailure('mismatch');return;}
  sending.current=true;setBusy(true);setFailure(null);
  try{
   const r=await fetch('/api/auth/change-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({currentPassword:current,newPassword:next})});
   if(!r.ok){const code=String(((await r.json().catch(()=>({}))) as {error?:unknown}).error??'');setFailure(code==='AUTHENTICATION_REQUIRED'?'session':code==='LOGIN_REJECTED'?'current':'rejected');return;}
   const channel=new BroadcastChannel('zao-rental-session');channel.postMessage('password-changed');channel.close();
   done.current=true;window.location.replace(new URL('/staff/login',location.origin).href);
  }catch{setFailure('network');}
  // While the browser leaves for the sign-in page after success, the form stays disabled.
  finally{if(!done.current){sending.current=false;setBusy(false);}}
 }
 const field=(name:string,label:string,auto:string,extra:{minLength?:number;describedBy?:string}={})=><label className="sx-field">{label}
  <input name={name} type="password" autoComplete={auto} required maxLength={128} minLength={extra.minLength} aria-describedby={extra.describedBy} aria-invalid={failure!==null&&(name!=='currentPassword'?failure==='mismatch'||failure==='length':failure==='current')||undefined}/></label>;
 return <div className="ox" lang={locale}>
  <div className="ox-head"><h1>{t('パスワード変更','Change password')}</h1></div>
  <form className="sx-card sx-form" style={{padding:'20px 24px',maxWidth:520}} onSubmit={e=>void submit(e)} aria-busy={busy} noValidate>
   {field('currentPassword',t('現在のパスワード','Current password'),'current-password')}
   {field('newPassword',t('新しいパスワード','New password'),'new-password',{minLength:15,describedBy:'pw-rule'})}
   <p id="pw-rule" className="sx-help">{t('15〜128文字。ほかのサービスと同じものは使わないでください。','15 to 128 characters. Do not reuse one from another service.')}</p>
   {field('confirmPassword',t('新しいパスワード（確認）','Confirm new password'),'new-password',{minLength:15})}
   {failure&&<p ref={alert} tabIndex={-1} role="alert" className="sx-alert" style={{margin:0}}>{message[failure]}</p>}
   <p className="sx-help">{t('変更すると、この端末を含むすべての端末でログアウトします。新しいパスワードでログインし直してください。','After the change you are signed out on every device, including this one. Sign in again with the new password.')}</p>
   <button type="submit" className="sx-btn sx-btn--primary" disabled={busy}>{busy?t('変更しています…','Changing…'):t('パスワードを変更','Change password')}</button>
  </form>
 </div>;
}
