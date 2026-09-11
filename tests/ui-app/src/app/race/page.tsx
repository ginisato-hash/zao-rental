"use client";
import {useMemo,useRef,useState} from 'react';
import {LedgerWorkspace} from '../../../../../apps/web/src/components/ledger/LedgerWorkspace';
import {fixtureClient} from '../../../fixture-client';
import type {LedgerDetail} from '../../../../../packages/contracts/src/ledger';
// Deterministic response ordering for component tests only. No timers, model calls or production route.
export default function Page(){
 const pending=useRef<(()=>void)[]>([]);const [count,setCount]=useState(0);const [completed,setCompleted]=useState(0);
 const client=useMemo(()=>({...fixtureClient,get:async(resource:Parameters<typeof fixtureClient.get>[0],id:string)=>{
  const value=await fixtureClient.get(resource,id);
  return new Promise<LedgerDetail>(resolve=>{pending.current.push(()=>{resolve(value);setCompleted(n=>n+1);});setCount(pending.current.length);});
 }}),[]);
 function release(last=false){const next=last?pending.current.pop():pending.current.shift();next?.();setCount(pending.current.length);}
 return <><section aria-label="応答順序テスト"><p>保留応答：{count} / 完了応答：{completed}</p><button onClick={()=>release()}>最初の応答を返す</button><button onClick={()=>release(true)}>最後の応答を返す</button></section><LedgerWorkspace client={client} canEdit testNotice/></>;
}
