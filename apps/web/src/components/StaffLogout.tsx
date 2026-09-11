 'use client';
import {useState} from 'react';
export function StaffLogout(){const [error,setError]=useState('');async function logout(){
 const channel=new BroadcastChannel('zao-rental-session');channel.postMessage('logout');channel.close();
 try{const r=await fetch('/api/auth/sign-out',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});if(!r.ok)throw new Error();window.location.replace('/staff/login');}catch{setError('ログアウトを確認できませんでした。もう一度実行してください。');}
 }return <main><h1>ログアウト</h1><button onClick={()=>void logout()}>ログアウトする</button>{error&&<p role="alert">{error}</p>}</main>;}
