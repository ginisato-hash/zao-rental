'use client';
import {useEffect,useRef,useState} from 'react';
import {invalidateStaffView} from './StaffSessionBoundary';
type Pending={path:string;body:{requestKey:string;input:unknown}};
// Preserve exactly the same logical request across response loss/reload. Session changes
// invalidate both displayed data and pending input; automatic retries are never scheduled.
export function useOperationsRequest(stamp:string,workspace:string){
 const storage='zao-operations-'+workspace,alive=useRef(false),lock=useRef(false),[busy,setBusy]=useState(false),[ready,setReady]=useState(false),[message,setMessage]=useState(''),[pending,setPending]=useState<Pending|null>(null);
 useEffect(()=>{alive.current=true;queueMicrotask(()=>{if(!alive.current)return;try{const saved=JSON.parse(sessionStorage.getItem(storage)??'null');if(saved?.stamp===stamp)setPending(saved.pending);else sessionStorage.removeItem(storage);setReady(true);}catch{setMessage('要求記録を開けません。端末の保存設定を確認してください。');}});return()=>{alive.current=false;};},[stamp,storage]);
 async function request<T>(path:string,body?:unknown):Promise<T>{const r=await fetch(path,{method:body===undefined?'GET':'POST',cache:'no-store',headers:{'content-type':'application/json','x-zao-session':stamp},...(body===undefined?{}:{body:JSON.stringify(body)})});const value=await r.json();if(r.status===401||r.status===403||value.error==='SESSION_CHANGED'){invalidateStaffView();throw Object.assign(Error('SESSION_CHANGED'),{definite:true});}if(!r.ok)throw Object.assign(Error(value.error??'OPERATION_FAILED'),{definite:r.status<500});return value;}
 async function load<T>(path:string,apply:(data:T)=>void){if(lock.current)return;lock.current=true;setBusy(true);try{const result=await request<T>(path);if(alive.current)apply(result);}catch(e){if(alive.current)setMessage((e as Error).message);}finally{lock.current=false;if(alive.current)setBusy(false);}}
 async function send<T>(path:string,input:unknown,apply:(data:T)=>void,retry=false){if(lock.current||!ready||pending&&!retry)return;const p=retry?pending!:{path,body:{requestKey:crypto.randomUUID(),input}};try{sessionStorage.setItem(storage,JSON.stringify({stamp,pending:p}));}catch{setReady(false);setMessage('要求を保存できないため送信していません。');return;}lock.current=true;setPending(p);setBusy(true);
  try{const result=await request<T>(p.path,p.body);sessionStorage.removeItem(storage);if(alive.current){setPending(null);setMessage('保存しました。');apply(result);}}
  catch(e){if(alive.current){if((e as {definite?:boolean}).definite){sessionStorage.removeItem(storage);setPending(null);}setMessage((e as {definite?:boolean}).definite?'操作を拒否しました：'+(e as Error).message:'応答未確認です。保存済みの同じ要求を照合してください。');}}
  finally{lock.current=false;if(alive.current)setBusy(false);}
 }
 return {busy,ready,message,pending,load,send,disabled:busy||!ready||!!pending};
}
