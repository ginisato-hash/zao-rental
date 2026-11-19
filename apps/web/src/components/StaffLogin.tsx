'use client';
import {useState,useSyncExternalStore} from 'react';
import {STAFF_LOCALE_COOKIE,type StaffLocale} from './staff-i18n';
const subscribe=()=>()=>{};
/** Staff sign-in, outside the shell: it has its own language switch (the same saved cookie the shell uses). */
export function StaffLogin({configured,initialLocale}:{configured:boolean;initialLocale:StaffLocale}){
 const ready=useSyncExternalStore(subscribe,()=>true,()=>false);
 const [failed,setFailed]=useState(false),[busy,setBusy]=useState(false),[locale,setLocaleState]=useState<StaffLocale>(initialLocale),t=(j:string,e:string)=>locale==='en'?e:j;
 function setLocale(next:StaffLocale){setLocaleState(next);document.cookie=`${STAFF_LOCALE_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol==='https:'?'; Secure':''}`;document.documentElement.lang=next;}
 async function login(event:React.FormEvent<HTMLFormElement>){event.preventDefault();if(busy||!ready||!configured)return;setBusy(true);setFailed(false);const form=event.currentTarget;const data=new FormData(form);
  try{const response=await fetch('/api/auth/sign-in/email',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:data.get('email'),password:data.get('password')})});
   form.reset();if(!response.ok)throw new Error();const channel=new BroadcastChannel('zao-rental-session');channel.postMessage('login-changed');channel.close();window.location.replace('/staff/ledger');
  }catch{setFailed(true);setBusy(false);}
 }
 return <section className="staff-login" lang={locale}>
  <div className="sx-seg" role="group" aria-label={t('表示言語','Language')}><button type="button" aria-pressed={locale==='ja'} onClick={()=>setLocale('ja')} lang="ja">日本語</button><button type="button" aria-pressed={locale==='en'} onClick={()=>setLocale('en')} lang="en">English</button></div>
  <h1>{t('スタッフログイン','Staff sign-in')}</h1>
  <p>{t('管理者が登録した個別のスタッフアカウントでログインします。','Sign in with the personal staff account an administrator created for you.')}</p>
  <form method="post" onSubmit={event=>void login(event)}><fieldset disabled={!ready||!configured||busy}><label>{t('メールアドレス','Email')}<input name="email" type="email" autoComplete="username" required maxLength={254}/></label><label>{t('パスワード','Password')}<input name="password" type="password" autoComplete="current-password" required maxLength={128}/></label><button disabled={!configured||busy}>{busy?t('確認中…','Checking…'):t('ログイン','Sign in')}</button></fieldset></form>
  {!configured&&<p>{t('スタッフ認証に接続できません。管理者に接続状態の確認を依頼してください。','Staff sign-in is not connected. Ask an administrator to check the connection.')}</p>}
  {failed&&<p role="alert">{t('ログインできませんでした。入力とアカウントの状態を確認してください。連続失敗時は時間をおいてお試しください。','Could not sign in. Check your entries and account status. After repeated failures, wait a while before trying again.')}</p>}
  <p>{t('自由な新規登録はできません。パスワード再設定のメール送信は未接続です。','There is no self sign-up. Password-reset emails are not connected.')}</p></section>;
}
