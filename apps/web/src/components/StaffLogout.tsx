'use client';
import {useState} from 'react';
import {useStaffLocale} from './staff-locale';
export function StaffLogout(){const [failed,setFailed]=useState(false),{locale}=useStaffLocale(),t=(j:string,e:string)=>locale==='en'?e:j;async function logout(){
 const channel=new BroadcastChannel('zao-rental-session');channel.postMessage('logout');channel.close();
 try{const r=await fetch('/api/auth/sign-out',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});if(!r.ok)throw new Error();window.location.replace('/staff/login');}catch{setFailed(true);}
 }return <main><h1>{t('サインアウト','Sign out')}</h1><button onClick={()=>void logout()}>{t('サインアウトする','Sign out now')}</button>{failed&&<p role="alert">{t('サインアウトを確認できませんでした。もう一度実行してください。','Sign-out could not be confirmed. Please try again.')}</p>}</main>;}
