'use client';
import {useRef,useState} from 'react';
import {useStaffLocale} from './staff-locale';
import {PreparationWorkbench} from './PreparationWorkbench';
import {invalidateStaffView} from './StaffSessionBoundary';
import {equipmentLabel,personLabel,shortRef} from './staff-labels';
import {fitBadge} from './fit-copy';
import type {PreparationMember,PreparationEvidence} from '../../../../packages/contracts/src/preparation';

// Group custody (Issue #47 B4). A confirmed group that is settled on site (usually still unpaid) appears under its group number with
// its parts and members; one part at a time is prepared and handed out through the same physical checks as a booking.
// Returns use the ordinary return reception below (scan the item): received items are labelled with the group number there.
type Member={memberId:string;memberKey:string;ordinal:number;label:string;manualFitRequired:boolean;equipment:{family:string;state:string}[]};
type Overview={groupId:string;groupNumber:string;groupLabel:string;status:string;lendable:boolean;memberCount:number;settlement:{paymentMethod:string;status:string;totalJpy:number;receivedJpy:number;outstandingJpy:number};parts:{partId:string;partNo:number;memberCount:number;holdStage:string|null;prepared:boolean;loansOut:number;loansReceived:number;members:Member[]}[]};
type Item={requirement_key:string;asset_id:string|null;pole_id:string|null;family:string;size:string};
type PartView={partId:string;groupId:string;groupNumber:string;groupLabel:string;partNo:number;groupRevision:number;holdVersion:number;holdStage:string;settlement:Overview['settlement'];members:{memberKey:string;label:string;manualFitRequired:boolean}[];manualFitMemberKeys:string[];preparationMembers:PreparationMember[];preparationValid:boolean;items:Item[];preparation:{version:number;fit_evidence?:PreparationEvidence}|null;loans:{id:string;family:string;requirement_key:string;state:string}[]};
type Pending={path:string;body:{requestKey:string;input:unknown}};
export function GroupCustodyPanel({stamp,disabled:outerDisabled}:{stamp:string;disabled:boolean}){
 const locale=useStaffLocale().locale,en=locale==='en',t=(j:string,e:string)=>en?e:j;
 const [number,setNumber]=useState(''),[overview,setOverview]=useState<Overview|null>(null),[part,setPart]=useState<PartView|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const [fit,setFit]=useState<Record<string,{confirmed:boolean;note:string}>>({});
 // A request that did not finish is retried with the SAME key (idempotent), never with a new one.
 const pending=useRef<Pending|null>(null);
 async function call(path:string,body?:unknown){
  const r=await fetch('/api/custody'+path,{method:body===undefined?'GET':'POST',cache:'no-store',headers:{'content-type':'application/json','x-zao-session':stamp},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const data=await r.json();if([401,403].includes(r.status)||data.error==='SESSION_CHANGED'){invalidateStaffView();throw Object.assign(new Error('SESSION_CHANGED'),{definite:true});}
  if(!r.ok)throw Object.assign(new Error(data.error),{definite:r.status<500});return data;
 }
 async function run(job:()=>Promise<void>){if(busy)return;setBusy(true);setMessage('');try{await job();}catch(e){const code=(e as Error).message;setMessage(code==='GROUP_CUSTODY_NOT_ACTIVATED'?t('団体の貸出・返却はまだ有効になっていません（データベース側の準備が未完了です）。通常の個別貸出には影響しません。','Group loans and returns are not enabled yet (the database side is not ready). Ordinary rentals are not affected.'):t('拒否：','Refused: ')+code);}finally{setBusy(false);}}
 const find=()=>run(async()=>{setPart(null);setOverview(await call('/group-number/'+encodeURIComponent(number.trim().toUpperCase())) as Overview);});
 const open=(id:string)=>run(async()=>{setFit({});setPart(await call('/group-part/'+id) as PartView);});
 const mutate=(path:string,input:unknown)=>run(async()=>{
  const p=pending.current&&pending.current.path===path&&JSON.stringify(pending.current.body.input)===JSON.stringify(input)?pending.current:{path,body:{requestKey:crypto.randomUUID(),input}};pending.current=p;
  try{const data=await call(p.path,p.body) as PartView;pending.current=null;setPart(data);setOverview(await call('/group/'+data.groupId) as Overview);}
  catch(e){if((e as {definite?:boolean}).definite)pending.current=null;throw e;}
 });
 const manual=part?.manualFitMemberKeys??[];
 const fitReady=manual.every(k=>fit[k]?.confirmed&&fit[k]!.note.trim().length>0);
 return <fieldset disabled={outerDisabled||busy} data-testid="group-custody"><legend>{t('団体予約の貸出準備・貸出（団体番号）','Group orders: prepare and hand out (group number)')}</legend>
  <label>{t('団体番号','Group number')}<input value={number} onChange={e=>setNumber(e.target.value)} maxLength={10} placeholder="G-000001"/></label>
  <button onClick={()=>void find()}>{t('団体と内訳を確認','Check the group and its members')}</button>
  {message&&<p role="status">{message}</p>}
  {overview&&<section aria-label={t('団体の内訳','Group breakdown')}>
   <p><strong>{overview.groupNumber}</strong> · {overview.groupLabel} · {overview.memberCount}{t('名','')} {en?'members':''}</p>
   <p>{t('支払い：現地精算 / ','Payment: on site / ')}<strong>{overview.settlement.status==='UNPAID'?t('未精算','Unsettled'):overview.settlement.status==='PAID'?t('精算済み','Settled'):overview.settlement.status==='PARTIALLY_PAID'?t('一部精算','Partly settled'):overview.settlement.status}</strong>{' · '}{overview.settlement.totalJpy.toLocaleString(en?'en-US':'ja-JP')} JPY</p>
   {!overview.lendable&&<p role="alert">{t('この団体はまだ確約されていない、または解除・取消されているため貸出できません。（状態：','This group is not confirmed, or it was released or cancelled, so nothing can be handed out. (Status: ')}{overview.status})</p>}
   {overview.parts.map(p=><article key={p.partId} aria-label={t('パート','Part')+' '+p.partNo}>
    <h3>{t('パート','Part')} {p.partNo} · {p.memberCount}{t('名','')} · {p.prepared?t('準備済み','Prepared'):t('未準備','Not prepared')} · {t('貸出中 ','Out ')}{p.loansOut} · {t('返却済み ','Returned ')}{p.loansReceived}</h3>
    <ul>{p.members.map(m=><li key={m.memberKey}>{m.label||m.memberKey}{m.manualFitRequired&&<> · <strong data-fit="MANUAL_FIT_REQUIRED">{fitBadge('MANUAL_FIT_REQUIRED',!en)}</strong></>}{m.equipment.length>0&&<> · {m.equipment.map(e=>equipmentLabel(e.family,undefined,locale)+' '+e.state).join(' / ')}</>}</li>)}</ul>
    {overview.lendable&&<button onClick={()=>void open(p.partId)}>{t('このパートを開く','Open this part')}</button>}
   </article>)}
  </section>}
  {part&&<section aria-label={t('パートの貸出','Part hand-out')}>
   <p>{part.groupNumber} · {t('パート','Part')} {part.partNo} · {shortRef(part.partId,locale)}</p>
   {manual.length>0&&<div role="group" aria-label={t('店頭での適合確認','In-store fit confirmation')}>
    <p role="note">{t('オンラインで適合を案内できないサイズです。現物を試着して確認した利用者だけ、貸出できます。','These sizes cannot be confirmed online. Only members whose fit was checked on the actual equipment can be handed out.')}</p>
    {manual.map(k=>{const m=part.members.find(x=>x.memberKey===k);return <div key={k}><label><input type="checkbox" checked={!!fit[k]?.confirmed} onChange={e=>setFit(f=>({...f,[k]:{confirmed:e.target.checked,note:f[k]?.note??''}}))}/>{personLabel(k+':X',part.items.map(i=>i.requirement_key),locale)} {m?.label} {t('の適合を現物で確認した','— fit checked on the actual equipment')}</label>
     <label>{t('確認の記録','Record of the check')}<input value={fit[k]?.note??''} maxLength={160} onChange={e=>setFit(f=>({...f,[k]:{confirmed:!!f[k]?.confirmed,note:e.target.value}}))}/></label></div>;})}
   </div>}
   <PreparationWorkbench key={JSON.stringify([part.partId,part.holdVersion,part.preparation?.version,part.items,part.preparationMembers])} members={part.preparationMembers} customerName={part.groupNumber+' '+part.groupLabel} ready={part.preparationValid} {...(part.preparation?.fit_evidence?{evidence:part.preparation.fit_evidence}:{})} disabled={busy||part.loans.length>0||!fitReady}
    onPrepare={fitEvidence=>void mutate('/group-prepare',{partId:part.partId,expectedGroupRevision:part.groupRevision,expectedHoldVersion:part.holdVersion,selections:part.items.map(i=>({requirementKey:i.requirement_key,assetId:i.asset_id,poleId:i.pole_id})),fitEvidence,manualFit:manual.map(k=>({memberKey:k,confirmed:!!fit[k]?.confirmed,note:fit[k]?.note.trim()??''}))})}/>
   {part.preparation&&part.preparationValid&&part.items.length>0&&part.loans.length===0&&<button onClick={()=>void mutate('/group-checkout',{partId:part.partId,expectedPreparationVersion:part.preparation!.version})}>{t('このパートの道具を貸出','Hand out this part’s equipment')}</button>}
   {part.loans.map(l=><p key={l.id}>{personLabel(l.requirement_key,part.items.map(i=>i.requirement_key),locale)} · {equipmentLabel(l.family,part.items.find(i=>i.requirement_key===l.requirement_key)?.size,locale)} · {l.state}</p>)}
   {part.loans.length>0&&<p>{t('返却は下の「実際の返却受領店舗」で用品を読み取ってください。団体番号つきで表示されます。','Receive returns below by scanning the item; received items are shown with the group number.')}</p>}
  </section>}
 </fieldset>;
}
