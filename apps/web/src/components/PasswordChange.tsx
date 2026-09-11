 'use client';
import {useState} from 'react';
export function PasswordChange(){const [error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function submit(event:React.FormEvent<HTMLFormElement>){event.preventDefault();setBusy(true);setError('');const form=event.currentTarget;const d=new FormData(form);
 try{const r=await fetch('/api/auth/change-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({currentPassword:d.get('currentPassword'),newPassword:d.get('newPassword')})});form.reset();if(!r.ok)throw new Error();const channel=new BroadcastChannel('zao-rental-session');channel.postMessage('password-changed');channel.close();window.location.replace('/staff/login');}catch{setError('変更できませんでした。現在のパスワードと入力長を確認してください。');setBusy(false);}}
 return <form className="staff-login" onSubmit={e=>void submit(e)}><label>現在のパスワード<input name="currentPassword" type="password" autoComplete="current-password" required maxLength={128}/></label><label>新しいパスワード（15〜128文字）<input name="newPassword" type="password" autoComplete="new-password" required minLength={15} maxLength={128}/></label><p>変更後はすべての端末で再ログインが必要です。</p><button disabled={busy}>パスワードを変更</button>{error&&<p role="alert">{error}</p>}</form>;
}
