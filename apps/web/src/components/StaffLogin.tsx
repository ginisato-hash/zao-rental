 'use client';
import {useState,useSyncExternalStore} from 'react';
const subscribe=()=>()=>{};
export function StaffLogin({configured}:{configured:boolean}){
 const ready=useSyncExternalStore(subscribe,()=>true,()=>false);
 const [error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function login(event:React.FormEvent<HTMLFormElement>){event.preventDefault();if(busy||!ready||!configured)return;setBusy(true);setError('');const form=event.currentTarget;const data=new FormData(form);
  try{const response=await fetch('/api/auth/sign-in/email',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:data.get('email'),password:data.get('password')})});
   form.reset();if(!response.ok)throw new Error();const channel=new BroadcastChannel('zao-rental-session');channel.postMessage('login-changed');channel.close();window.location.replace('/staff/ledger');
  }catch{setError('ログインできませんでした。入力とアカウントの状態を確認してください。連続失敗時は時間をおいてお試しください。');setBusy(false);}
 }
 return <section className="staff-login"><p>管理者が登録した個別のスタッフアカウントでログインします。</p><form method="post" onSubmit={event=>void login(event)}><fieldset disabled={!ready||!configured||busy}><label>メールアドレス<input name="email" type="email" autoComplete="username" required maxLength={254}/></label><label>パスワード<input name="password" type="password" autoComplete="current-password" required maxLength={128}/></label><button disabled={!configured||busy}>{busy?'確認中…':'ログイン'}</button></fieldset></form>{!configured&&<p>開発用DBに接続されていません。専用の開発起動手順を使用してください。</p>}{error&&<p role="alert">{error}</p>}<p>自由な新規登録はできません。パスワード再設定のメール送信は未接続です。</p></section>;
}
