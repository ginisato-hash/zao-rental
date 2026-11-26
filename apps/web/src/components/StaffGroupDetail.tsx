'use client';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import Link from 'next/link';
import {useStaffLocaleOr} from './staff-locale';
import type {StaffLocale} from './staff-i18n';
import {StaffSessionBoundary,invalidateStaffView} from './StaffSessionBoundary';
import {groupError,gt,type GKey} from './staff-groups-text';
import {discountYen,jstDateTime,storeName,yen} from './guest-format';
import {fitBadge} from './fit-copy';
import type {FitKind} from '../../../../packages/contracts/src/size-edge';
import './staff-orders.css';
import './staff-groups.css';

type Item={family:string;variantIds:string[]};
type Member={id:string;ordinal:number;label:string;selection:{product:string;age:string;tier:string;items:Item[]};fit:Record<string,unknown>|null;profile?:Record<string,unknown>};
type PriceLine={memberId:string;ordinal:number;baseJpy:number;memberDiscountJpy:number;groupDiscountJpy:number;finalJpy:number};
type Adj={target:'MEMBER'|'GROUP';memberId?:string;method:'FIXED_JPY'|'PERCENT_BPS';value:number;reason:string};
type Pricing={baseJpy:number;subtotalJpy:number;bundleDiscountJpy:number;memberDiscountJpy:number;groupDiscountJpy:number;totalJpy:number;members:PriceLine[]};
type Payment={id:string;kind:'RECEIPT'|'REVERSAL';amountJpy:number;method:string;receivedAt:string;reversesId:string|null;reason:string|null;note:string;recordedAt:string};
type Detail={group:{id:string;groupNumber:string;status:string;revision:number;label:string;locale:string;pickupStore:string;returnStore:string;period:{startDate:string;endDate:string};memberCount:number;confirmedTotalJpy:number|null;heldAt:string|null;releasedAt:string|null;attention:{kind:string;daysPastStart:number}|null;contactName:string;contactEmail:string;contactPhone:string|null};
 members:Member[];parts:{partNo:number;generation:number;active:boolean;members:number}[];events:{id:number;revision:number;event_type:string;actor:string;payload:Record<string,unknown>;occurred_at:string}[];
 settlement:{status:string;totalJpy:number;receivedJpy:number;outstandingJpy:number};adjustments?:Adj[];adjustmentRows:{target:string;memberId:string|null;method:string;value:number;reason:string;beforeJpy:number;afterJpy:number}[];
 payments:Payment[];changeRequests:{id:string;kind:string;body:string;status:string;createdAt:string}[];notifications:{eventType:string;status:string;attemptCount:number;failureCode:string;createdAt:string;sentAt:string|null}[];
 pricing:Pricing|null;pricingError:string|null;confirmedLines:PriceLine[]|null;consent:{maxTotalJpy:number}|null};
type Variant={id:string;family:string;age:string;tier:string;size:string;model:string};
type Can={approve:boolean;discount:boolean;release:boolean;cancel:boolean;payment:boolean};
type Row={method:''|'FIXED_JPY'|'PERCENT_BPS';value:string;reason:string};
const EMPTY:Row={method:'',value:'',reason:''};
const HELD_STATES=['REVIEW_HELD','CHANGES_REQUESTED'];
const PROFILE_LABEL:Record<string,[string,string]>={heightCm:['身長(cm)','Height (cm)'],weightKg:['体重(kg)','Weight (kg)'],footCm:['足長(cm)','Foot (cm)'],level:['レベル','Level'],skill:['レベル','Level'],age:['年齢','Age'],stance:['スタンス','Stance']};
const nowJstLocal=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date()).replace(' ','T');
const fitKind=(f:Record<string,unknown>|null):string|null=>{if(!f)return null;const k=(f.kind??f.status);return typeof k==='string'?k:null;};
const toBps=(s:string)=>{const t=s.trim();if(!/^\d{1,3}(\.\d{1,2})?$/.test(t))return null;const b=Math.round(parseFloat(t)*100);return b>=1&&b<=10000?b:null;};
const toYen=(s:string)=>{const t=s.trim();return /^\d{1,9}$/.test(t)&&Number(t)>=1?Number(t):null;};
const rowFromAdj=(a:Adj|undefined):Row=>a?{method:a.method,value:a.method==='PERCENT_BPS'?String(a.value/100):String(a.value),reason:a.reason}:EMPTY;

export function StaffGroupDetail({locale:serverLocale,stamp,id,can}:{locale:StaffLocale;stamp:string;id:string;can:Can}){
 const locale=useStaffLocaleOr(serverLocale),ja=locale!=='en',tx=(k:GKey)=>gt(locale,k);
 const [d,setD]=useState<Detail|null>(null),[loadErr,setLoadErr]=useState<string|null>(null),[reload,setReload]=useState(0),gen=useRef(0);
 const [variants,setVariants]=useState<Map<string,Variant>>(new Map()),[variantsFailed,setVariantsFailed]=useState(false);
 const [msg,setMsg]=useState<{kind:'ok'|'err';text:string}|null>(null),[busy,setBusy]=useState(false),pending=useRef(new Map<string,string>());
 // editors
 const [editing,setEditing]=useState<string|null>(null),[edits,setEdits]=useState<Record<string,Record<string,string>>>({});
 const dirtyRef=useRef(false),markDirty=(v:boolean)=>{dirtyRef.current=v;setDirtyState(v);};
 const [dirty,setDirtyState]=useState(false);
 const [dm,setDm]=useState<Record<string,Row>>({}),[dg,setDg]=useState<Row>(EMPTY),[preview,setPreview]=useState<{sig:string;data:Pricing&{audit:{target:string;memberId:string|null;beforeJpy:number;afterJpy:number}[]}}|null>(null);
 const [message,setMessage]=useState(''),[noCharge,setNoCharge]=useState(false),[fitAck,setFitAck]=useState<Record<string,boolean>>({}),[changesMsg,setChangesMsg]=useState('');
 const [releaseOpen,setReleaseOpen]=useState(false),[releaseReason,setReleaseReason]=useState(''),[releaseMsg,setReleaseMsg]=useState('');
 const [cancelOpen,setCancelOpen]=useState(false),[cancelReason,setCancelReason]=useState('');
 const [pay,setPay]=useState({amount:'',method:'CASH',at:nowJstLocal(),note:''}),[reversing,setReversing]=useState<string|null>(null),[reverseReason,setReverseReason]=useState('');

 useEffect(()=>{const ticket=++gen.current;queueMicrotask(async()=>{
  try{const r=await fetch('/api/staff/groups/'+id,{cache:'no-store',headers:{'x-zao-session':stamp}});if(r.status===401){invalidateStaffView();return;}
   const v=await r.json().catch(()=>({})) as Detail&{error?:string};if(!r.ok)throw new Error(v.error??'LOAD');
   if(ticket===gen.current){setD(v);setLoadErr(null);
    // The saved discount set seeds the editor on every fresh load unless the administrator is mid-edit.
    if(!dirtyRef.current){const m:Record<string,Row>={};let g=EMPTY;for(const a of v.adjustments??[]){if(a.target==='GROUP')g=rowFromAdj(a);else if(a.memberId)m[a.memberId]=rowFromAdj(a);}setDm(m);setDg(g);setPreview(null);}}}
  catch(e){if(ticket===gen.current)setLoadErr(e instanceof Error?e.message:'LOAD');}
 });},[stamp,id,reload]);
 useEffect(()=>{let live=true;queueMicrotask(async()=>{
  try{const r=await fetch(`/api/staff/groups/${id}/variants`,{cache:'no-store',headers:{'x-zao-session':stamp}});if(!r.ok)throw new Error();const v=await r.json() as {variants:Variant[]};if(live){setVariants(new Map(v.variants.map(x=>[x.id,x])));setVariantsFailed(false);}}
  catch{if(live)setVariantsFailed(true);}});return()=>{live=false;};},[stamp,id,reload]);

 const act=useCallback(async(op:string,body:Record<string,unknown>,opts:{key?:boolean;refresh?:boolean}={}):Promise<{ok:boolean;data?:Record<string,unknown>;code?:string}>=>{
  const withKey=opts.key!==false,sig=op+JSON.stringify(body);let key=pending.current.get(sig);if(!key){key=crypto.randomUUID();pending.current.set(sig,key);}
  setBusy(true);setMsg(null);
  try{const r=await fetch(`/api/staff/groups/${id}/${op}`,{method:'POST',headers:{'content-type':'application/json','x-zao-session':stamp},body:JSON.stringify(withKey?{requestKey:key,...body}:body)});
   if(r.status===401){invalidateStaffView();return {ok:false};}
   const v=await r.json().catch(()=>({})) as Record<string,unknown>&{error?:string;detail?:unknown};
   if(r.status!==503)pending.current.delete(sig);
   if(!r.ok){const code=String(v.error??'');setMsg({kind:'err',text:groupError(code,locale,v.detail)});if(code==='STALE_REVISION'||code==='INVALID_STATE')setReload(n=>n+1);return {ok:false,code};}
   if(opts.refresh!==false){markDirty(false);setReload(n=>n+1);}
   return {ok:true,data:v};
  }catch{setMsg({kind:'err',text:tx('lostResponse')});return {ok:false};}finally{setBusy(false);}
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[id,stamp,locale]);

 const g=d?.group;const held=Boolean(g&&HELD_STATES.includes(g.status));
 const lineOf=useMemo(()=>{const m=new Map<string,PriceLine>();for(const l of (g?.status==='CONFIRMED'?d?.confirmedLines:d?.pricing?.members)??[])m.set(l.memberId,l);return m;},[d,g?.status]);
 const sizeOf=(v:string)=>variants.get(v)?`${variants.get(v)!.size}`:'…';
 const itemText=(i:Item)=>`${i.family} ${i.variantIds.map(sizeOf).join('/')}`;
 const fitText=(f:Record<string,unknown>|null)=>{const k=fitKind(f);if(!k||k==='NORMAL')return null;
  if(k==='ADMIN_SELECTED')return tx('fitAdmin');
  if(k==='EDGE_BELOW'||k==='EDGE_ABOVE'||k==='NEAREST_AVAILABLE'||k==='MANUAL_FIT_REQUIRED')return fitBadge(k as FitKind,ja);
  return k;};
 const manualMembers=(d?.members??[]).filter(m=>fitKind(m.fit)==='MANUAL_FIT_REQUIRED');

 // ---------- discounts
 const built=useMemo(()=>{
  if(!d)return {list:[] as Adj[],error:false};const list:Adj[]=[];let error=false;
  const one=(r:Row,target:'MEMBER'|'GROUP',memberId?:string)=>{if(!r.method)return;const value=r.method==='PERCENT_BPS'?toBps(r.value):toYen(r.value),reason=r.reason.trim();
   if(value===null||!reason||reason.length>200){error=true;return;}list.push({target,...(memberId?{memberId}:{}),method:r.method,value,reason});};
  for(const m of d.members)one(dm[m.id]??EMPTY,'MEMBER',m.id);one(dg,'GROUP');return {list,error};
 },[d,dm,dg]);
 const sig=JSON.stringify(built.list);
 const setRow=(mid:string,patch:Partial<Row>)=>{markDirty(true);setPreview(null);setDm(o=>({...o,[mid]:{...(o[mid]??EMPTY),...patch}}));};
 const runPreview=async()=>{if(built.error||!built.list.length){setMsg({kind:'err',text:tx('dInvalid')});return;}
  const r=await act('preview-adjustments',{adjustments:built.list},{key:false,refresh:false});if(r.ok)setPreview({sig,data:r.data as never});};
 const saveDiscounts=async()=>{if(!d||!preview||preview.sig!==sig)return;const r=await act('adjustments',{expectedRevision:d.group.revision,adjustments:built.list},{key:false});if(r.ok){setMsg({kind:'ok',text:tx('dSaved')});markDirty(false);}};

 // ---------- member edit
 const diffs=useMemo(()=>{const out:{memberId:string;label:string;family:string;from:string;to:string}[]=[];
  for(const m of d?.members??[])for(const [family,vid] of Object.entries(edits[m.id]??{})){const cur=m.selection.items.find(i=>i.family===family)?.variantIds[0];if(cur&&cur!==vid)out.push({memberId:m.id,label:m.label||String(m.ordinal),family,from:sizeOf(cur),to:sizeOf(vid)});}
  return out;
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[edits,d,variants]);
 const applyEdits=async()=>{if(!d||!diffs.length)return;
  const byMember=new Map<string,{family:string;variantIds:string[]}[]>();for(const x of diffs){const family=x.family,vid=edits[x.memberId]![family]!;byMember.set(x.memberId,[...(byMember.get(x.memberId)??[]),{family,variantIds:[vid]}]);}
  const open=d.changeRequests.find(c=>c.status==='OPEN'&&c.kind==='CHANGE')?.id??null;
  const r=await act('members',{expectedRevision:d.group.revision,changeRequestId:open,edits:[...byMember].map(([memberId,items])=>({memberId,items}))});
  if(r.ok){setEdits({});setEditing(null);setMsg({kind:'ok',text:tx('editApplied')});}};

 // ---------- actions
 const confirmNow=async()=>{if(!d)return;const r=await act('confirm',{expectedRevision:d.group.revision,message:message.trim()?message:null,noChargeConfirmed:noCharge,fitAcknowledgedMemberIds:manualMembers.filter(m=>fitAck[m.id]).map(m=>m.id)});
  if(r.ok)setMsg({kind:'ok',text:r.data?.replayed?tx('confirmDoneReplay'):tx('confirmDone')});};
 const sendBack=async()=>{if(!d)return;if(!changesMsg.trim()){setMsg({kind:'err',text:tx('changesNeed')});return;}const r=await act('request-changes',{expectedRevision:d.group.revision,message:changesMsg});if(r.ok){setChangesMsg('');setMsg({kind:'ok',text:tx('changesDone')});}};
 const releaseNow=async()=>{if(!d)return;if(!releaseReason.trim()){setMsg({kind:'err',text:tx('releaseNeed')});return;}
  const r=await act('release',{expectedRevision:d.group.revision,reason:releaseReason.trim(),...(releaseMsg.trim()?{message:releaseMsg}:{message:null})});
  if(r.ok){setReleaseOpen(false);setReleaseReason('');setReleaseMsg('');setMsg({kind:'ok',text:tx('releaseDone')});}};
 const cancelNow=async()=>{if(!d)return;if(!cancelReason.trim()){setMsg({kind:'err',text:tx('releaseNeed')});return;}
  const r=await act('cancel',{expectedRevision:d.group.revision,reason:cancelReason.trim(),message:null});if(r.ok){setCancelOpen(false);setCancelReason('');setMsg({kind:'ok',text:tx('cancelDone')});}};
 const record=async()=>{const amount=/^\d{1,9}$/.test(pay.amount.trim())?Number(pay.amount):0;const at=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(pay.at)?new Date(pay.at+':00+09:00'):null;
  if(amount<1||!at||Number.isNaN(at.getTime())){setMsg({kind:'err',text:tx('payInvalid')});return;}
  const r=await act('receipt',{amountJpy:amount,method:pay.method,receivedAt:at.toISOString(),note:pay.note.trim()});if(r.ok){setPay({amount:'',method:'CASH',at:nowJstLocal(),note:''});setMsg({kind:'ok',text:tx('payDone')});}};
 const reverse=async(pid:string)=>{if(!reverseReason.trim()){setMsg({kind:'err',text:tx('releaseNeed')});return;}const r=await act('reverse-receipt',{paymentId:pid,reason:reverseReason.trim()});if(r.ok){setReversing(null);setReverseReason('');setMsg({kind:'ok',text:tx('payRevDone')});}};

 if(loadErr)return <StaffSessionBoundary stamp={stamp}><main className="ox gx"><p className="sx-alert" role="alert">{loadErr==='NOT_FOUND'||loadErr==='FORBIDDEN'||loadErr==='GROUP_NOT_CONNECTED'||loadErr==='INVALID_ID'?(loadErr==='NOT_FOUND'||loadErr==='INVALID_ID'?tx('notFound'):groupError(loadErr,locale)):tx('loadFailed')} <button type="button" className="sx-link" onClick={()=>setReload(n=>n+1)}>{tx('retry')}</button></p><p><Link href="/staff/groups">{tx('back')}</Link></p></main></StaffSessionBoundary>;
 if(!d||!g)return <StaffSessionBoundary stamp={stamp}><main className="ox gx"><p className="sx-status" role="status">{tx('loading')}</p></main></StaffSessionBoundary>;

 const status=g.status,pricing=d.pricing,openChange=d.changeRequests.filter(c=>c.status==='OPEN');
 const reversedIds=new Set(d.payments.filter(p=>p.kind==='REVERSAL').map(p=>p.reversesId));
 const itemSummary=(()=>{const m=new Map<string,number>();for(const x of d.members)for(const i of x.selection.items)m.set(i.family,(m.get(i.family)??0)+1);return [...m].map(([f,n])=>`${f} × ${n}`).join(' · ');})();
 const prettyProfile=(p?:Record<string,unknown>)=>p?Object.entries(p).filter(([k,v])=>k!=='synthetic'&&(typeof v==='string'||typeof v==='number')).map(([k,v])=>`${PROFILE_LABEL[k]?.[ja?0:1]??k} ${v}`).join(' · '):'';

 return <StaffSessionBoundary stamp={stamp}><main className="ox gx">
  <p><Link href="/staff/groups">← {tx('back')}</Link></p>
  <div className="ox-head"><h1>{g.groupNumber}</h1><span className={'gx-badge gx-badge--'+status}>{tx(('st.'+status) as GKey)}</span>
   {status==='CONFIRMED'&&<span className="gx-badge">{tx(('se.'+d.settlement.status) as GKey)}</span>}</div>
  <p className="gx-sub">{g.label}</p>
  {g.attention&&held&&<p className="gx-warn" role="note">{tx('attention')} ({g.attention.daysPastStart}{ja?'':' '}{tx('passedDays')})</p>}
  <div aria-live="polite">{msg&&<p className={msg.kind==='ok'?'sx-status gx-msg':'sx-alert gx-msg'} role={msg.kind==='ok'?'status':'alert'}>{msg.text}</p>}</div>
  <div className="gx-layout">
   <div className="gx-left">
    <section className="sx-card gx-card" aria-labelledby="gx-members"><h2 id="gx-members">{tx('members')} <small>({g.memberCount})</small></h2>
     {variantsFailed&&<p className="sx-alert" role="alert">{tx('variantsFailed')}</p>}
     <div className="ox-table-wrap" tabIndex={0} role="region" aria-label={tx('members')}><table className="sx-table gx-table gx-mtable"><thead><tr><th>{tx('mNo')}</th><th>{tx('mName')}</th><th>{tx('mProfile')}</th><th>{tx('mItems')}</th><th>{tx('mFit')}</th><th>{tx('mStock')}</th><th>{tx('mPrice')}</th>{can.approve&&held&&<th><span className="gx-sr">{tx('mEdit')}</span></th>}</tr></thead>
      <tbody>{d.members.map(m=>{const l=lineOf.get(m.id),ft=fitText(m.fit),staged=edits[m.id]??{};
       const opts=(it:Item)=>{const cur=variants.get(it.variantIds[0]??'');return cur?[...variants.values()].filter(v=>v.family===it.family&&v.age===cur.age&&v.tier===cur.tier):[];};
       return [<tr key={m.id} data-member={m.ordinal}>
        <td>{m.ordinal}</td><td>{m.label||'—'}</td><td className="gx-small">{prettyProfile(m.profile)}</td>
        <td className="gx-small">{m.selection.items.map((i,k)=>{const nv=staged[i.family];return <div key={k}>{nv&&nv!==i.variantIds[0]?<><s>{itemText(i)}</s> → <strong>{i.family} {sizeOf(nv)}</strong></>:itemText(i)}</div>;})}</td>
        <td>{ft?<span className={'gx-badge'+(fitKind(m.fit)==='MANUAL_FIT_REQUIRED'?' gx-badge--warn':'')}>{ft}</span>:'—'}</td>
        <td>{held||status==='CONFIRMED'?tx('stockHeld'):tx('stockNone')}</td>
        <td className="gx-num">{l?<>{yen(ja,l.finalJpy)}{(l.memberDiscountJpy+l.groupDiscountJpy)>0&&<><br/><small>{tx('priceBase')} {yen(ja,l.baseJpy)} · {discountYen(ja,l.memberDiscountJpy+l.groupDiscountJpy)}</small></>}</>:'—'}</td>
        {can.approve&&held&&<td><button type="button" className="sx-btn" aria-expanded={editing===m.id} onClick={()=>setEditing(editing===m.id?null:m.id)} aria-label={`${tx('mEdit')} ${m.ordinal}`}>{tx('mEdit')}</button></td>}
       </tr>,editing===m.id&&<tr key={m.id+'e'} className="gx-editrow"><td colSpan={8}><fieldset className="gx-edit"><legend>{tx('editTitle')} · {m.ordinal} {m.label}</legend>
        {m.selection.items.map((i,k)=>{const o=opts(i);const cur=i.variantIds[0];return <label key={k}>{i.family} · {tx('sizeLabel')}
         {i.variantIds.length===1&&o.length>0?<select value={staged[i.family]??cur} onChange={e=>setEdits(x=>({...x,[m.id]:{...(x[m.id]??{}),[i.family]:e.target.value}}))}>{o.map(v=><option key={v.id} value={v.id}>{v.size} · {v.model}</option>)}</select>:<span>{itemText(i)}</span>}</label>;})}
       </fieldset></td></tr>];})}</tbody></table></div>
     {can.approve&&held&&Object.keys(edits).length>0&&<div className="gx-diff"><h3>{tx('editDiff')}</h3>
      {diffs.length?<ul className="gx-list">{diffs.map((x,i)=><li key={i}>{x.label} · {x.family}: {x.from} → {x.to}</li>)}</ul>:<p className="sx-help">{tx('editNoChange')}</p>}
      <p className="sx-help">{tx('editNote')}</p>
      <div className="gx-actions"><button type="button" className="sx-btn sx-btn--primary" disabled={busy||!diffs.length} onClick={()=>void applyEdits()}>{tx('editApply')}</button>
       <button type="button" className="sx-btn" disabled={busy} onClick={()=>{setEdits({});setEditing(null);}}>{tx('editCancel')}</button></div></div>}
    </section>

    {can.discount&&held&&<section className="sx-card gx-card" aria-labelledby="gx-disc"><h2 id="gx-disc">{tx('disc')}</h2><p className="sx-help">{tx('discHelp')}</p>
     <div className="ox-table-wrap" tabIndex={0} role="region" aria-label={tx('disc')}><table className="sx-table gx-table gx-disc"><thead><tr><th>{tx('dMemberRow')}</th><th>{tx('dMethod')}</th><th>{tx('dValue')}</th><th>{tx('dReason')}</th></tr></thead><tbody>
      {d.members.map(m=>{const r=dm[m.id]??EMPTY;return <tr key={m.id}><td>{m.ordinal} {m.label}</td>
       <td><select aria-label={`${tx('dMethod')} ${m.ordinal}`} value={r.method} onChange={e=>setRow(m.id,{method:e.target.value as Row['method']})}><option value="">{tx('dNone')}</option><option value="FIXED_JPY">{tx('dFixed')}</option><option value="PERCENT_BPS">{tx('dPercent')}</option></select></td>
       <td><input aria-label={`${tx('dValue')} ${m.ordinal}`} inputMode="decimal" disabled={!r.method} value={r.value} onChange={e=>setRow(m.id,{value:e.target.value})}/></td>
       <td><input aria-label={`${tx('dReason')} ${m.ordinal}`} maxLength={200} disabled={!r.method} value={r.reason} onChange={e=>setRow(m.id,{reason:e.target.value})}/></td></tr>;})}
      <tr className="gx-grouprow"><td><strong>{tx('dGroupRow')}</strong></td>
       <td><select aria-label={`${tx('dMethod')} ${tx('dGroupRow')}`} value={dg.method} onChange={e=>{markDirty(true);setPreview(null);setDg(o=>({...o,method:e.target.value as Row['method']}));}}><option value="">{tx('dNone')}</option><option value="FIXED_JPY">{tx('dFixed')}</option><option value="PERCENT_BPS">{tx('dPercent')}</option></select></td>
       <td><input aria-label={`${tx('dValue')} ${tx('dGroupRow')}`} inputMode="decimal" disabled={!dg.method} value={dg.value} onChange={e=>{markDirty(true);setPreview(null);setDg(o=>({...o,value:e.target.value}));}}/></td>
       <td><input aria-label={`${tx('dReason')} ${tx('dGroupRow')}`} maxLength={200} disabled={!dg.method} value={dg.reason} onChange={e=>{markDirty(true);setPreview(null);setDg(o=>({...o,reason:e.target.value}));}}/></td></tr>
     </tbody></table></div>
     {built.error&&<p className="sx-alert" role="alert">{tx('dInvalid')}</p>}
     <div className="gx-actions"><button type="button" className="sx-btn" disabled={busy||!built.list.length} onClick={()=>void runPreview()}>{tx('dPreview')}</button>
      <button type="button" className="sx-btn sx-btn--primary" disabled={busy||!preview||preview.sig!==sig} onClick={()=>void saveDiscounts()}>{tx('dSave')}</button>
      {dirty&&<button type="button" className="sx-btn" disabled={busy} onClick={()=>{markDirty(false);setReload(n=>n+1);}}>{tx('dReset')}</button>}</div>
     {!preview&&built.list.length>0&&<p className="sx-help">{dirty?tx('dPreviewFirst'):tx('dPreviewFirst')}</p>}
     {preview&&preview.sig===sig&&<div className="gx-preview" data-testid="discount-preview"><h3>{tx('dPreview')}</h3>
      <table className="sx-table gx-table"><thead><tr><th>{tx('dMemberRow')}</th><th>{tx('dBefore')}</th><th>{tx('dAfter')}</th></tr></thead><tbody>
       {preview.data.members.map(p=><tr key={p.memberId}><td>{p.ordinal}</td><td>{yen(ja,p.baseJpy)}</td><td>{yen(ja,p.finalJpy)}</td></tr>)}
       <tr><td><strong>{tx('qTotal')}</strong></td><td>{yen(ja,preview.data.baseJpy)}</td><td><strong>{yen(ja,preview.data.totalJpy)}</strong></td></tr></tbody></table>
      {preview.data.totalJpy===0&&<p className="gx-warn" role="note">{tx('dZero')}</p>}</div>}
     {d.adjustmentRows.length>0&&<details><summary>{tx('dCurrent')}</summary><ul className="gx-list">{d.adjustmentRows.map((a,i)=><li key={i}>{a.target==='GROUP'?tx('dGroupRow'):(d.members.find(m=>m.id===a.memberId)?.ordinal??'—')}: {a.method==='PERCENT_BPS'?`${a.value/100}%`:yen(ja,a.value)} · {yen(ja,a.beforeJpy)} → {yen(ja,a.afterJpy)} · {a.reason}</li>)}</ul></details>}
    </section>}
   </div>

   <div className="gx-right">
    <section className="sx-card gx-card" aria-labelledby="gx-sum"><h2 id="gx-sum">{tx('summary')}</h2>
     <dl className="gx-dl"><dt>{tx('rep')}</dt><dd>{g.contactName}</dd><dt>{tx('email')}</dt><dd className="gx-break">{g.contactEmail}</dd>{g.contactPhone&&<><dt>{tx('phone')}</dt><dd>{g.contactPhone}</dd></>}
      <dt>{tx('period')}</dt><dd>{g.period.startDate}{g.period.endDate!==g.period.startDate?' – '+g.period.endDate:''}</dd>
      <dt>{tx('stations')}</dt><dd>{storeName(ja,g.pickupStore)} / {storeName(ja,g.returnStore)}</dd><dt>{tx('people')}</dt><dd>{g.memberCount}</dd><dt>{tx('language')}</dt><dd>{g.locale==='en'?'English':'日本語'}</dd>
      {g.heldAt&&<><dt>{tx('heldAt')}</dt><dd>{jstDateTime(ja,g.heldAt)}</dd></>}</dl>
     {d.changeRequests.length>0&&<><h3>{tx('openRequests')}</h3><ul className="gx-list">{d.changeRequests.map(c=><li key={c.id}><strong>{tx(c.kind==='DECLINE'?'reqDecline':c.kind==='ADMIN_REQUEST'?'reqAdmin':'reqChange')}</strong> · {tx(c.status==='OPEN'?'reqOpen':c.status==='APPLIED'?'reqApplied':'reqRejected')} · {jstDateTime(ja,c.createdAt)}<br/><span className="gx-body">{c.body}</span></li>)}</ul>{openChange.length>0&&<p className="sx-help">{tx('reqHint')}</p>}</>}
    </section>

    <section className="sx-card gx-card" aria-labelledby="gx-quote"><h2 id="gx-quote">{tx('quote')}</h2>
     <p className="gx-pay"><strong>{tx('payOnSite')}</strong><br/><small>{tx('noOnline')}</small></p>
     {pricing&&status!=='CONFIRMED'&&<dl className="gx-dl gx-money"><dt>{tx('qSubtotal')}</dt><dd>{yen(ja,pricing.subtotalJpy)}</dd>{pricing.bundleDiscountJpy>0&&<><dt>{tx('qBundle')}</dt><dd>{discountYen(ja,pricing.bundleDiscountJpy)}</dd></>}
      <dt>{tx('qMember')}</dt><dd>{discountYen(ja,pricing.memberDiscountJpy)}</dd><dt>{tx('qGroup')}</dt><dd>{discountYen(ja,pricing.groupDiscountJpy)}</dd><dt>{tx('qProvisional')}</dt><dd data-testid="quote-total"><strong>{yen(ja,pricing.totalJpy)}</strong></dd></dl>}
     {d.pricingError&&<p className="sx-alert" role="alert">{groupError(d.pricingError,locale)}</p>}
     {status==='CONFIRMED'&&<dl className="gx-dl gx-money"><dt>{tx('qConfirmedTotal')}</dt><dd data-testid="confirmed-total"><strong>{yen(ja,g.confirmedTotalJpy)}</strong></dd>
      <dt>{tx('qReceived')}</dt><dd data-testid="received-total">{yen(ja,d.settlement.receivedJpy)}</dd><dt>{tx('qOutstanding')}</dt><dd data-testid="outstanding-total">{yen(ja,d.settlement.outstandingJpy)}</dd></dl>}
     {status==='CONFIRMED'&&<p className="sx-help">{tx('qNotIncome')}</p>}
     {held&&(d.consent?<p className="sx-help">{tx('consent')}: {yen(ja,d.consent.maxTotalJpy)}</p>:<p className="gx-warn" role="note">{tx('noConsent')}</p>)}
    </section>

    {can.approve&&status==='REVIEW_HELD'&&<section className="sx-card gx-card" aria-labelledby="gx-confirm"><h2 id="gx-confirm">{tx('confirmTitle')}</h2><p className="sx-help">{tx('confirmHelp')}</p>
     <label className="gx-field">{tx('message')}<textarea rows={4} maxLength={2000} value={message} onChange={e=>setMessage(e.target.value)}/></label><p className="sx-help">{message.length}/2000 {tx('messageCount')}</p>
     {pricing&&<ul className="gx-list" aria-label={tx('confirmWill')}><li>{tx('qTotal')}: <strong>{yen(ja,pricing.totalJpy)}</strong></li><li>{tx('qMember')} + {tx('qGroup')}: {discountYen(ja,pricing.memberDiscountJpy+pricing.groupDiscountJpy)}</li><li>{tx('payOnSite')}</li></ul>}
     {pricing?.totalJpy===0&&<label className="sx-check gx-check"><input type="checkbox" checked={noCharge} onChange={e=>setNoCharge(e.target.checked)}/><span>{tx('confirmNoCharge')}</span></label>}
     {manualMembers.length>0&&<fieldset className="gx-fit"><legend>{tx('confirmFit')}</legend>{manualMembers.map(m=><label key={m.id} className="sx-check gx-check"><input type="checkbox" checked={Boolean(fitAck[m.id])} onChange={e=>setFitAck(o=>({...o,[m.id]:e.target.checked}))}/><span>{m.ordinal} {m.label}</span></label>)}</fieldset>}
     <div className="gx-actions"><button type="button" className="sx-btn sx-btn--primary" disabled={busy||!pricing||!d.consent||(pricing?.totalJpy===0&&!noCharge)||manualMembers.some(m=>!fitAck[m.id])} onClick={()=>void confirmNow()}>{tx('confirmBtn')}</button></div>
    </section>}

    {can.approve&&status==='REVIEW_HELD'&&<section className="sx-card gx-card" aria-labelledby="gx-changes"><h2 id="gx-changes">{tx('changesTitle')}</h2><p className="sx-help">{tx('changesHelp')}</p>
     <label className="gx-field">{tx('message')}<textarea rows={3} maxLength={2000} value={changesMsg} onChange={e=>setChangesMsg(e.target.value)}/></label>
     <div className="gx-actions"><button type="button" className="sx-btn" disabled={busy||!changesMsg.trim()} onClick={()=>void sendBack()}>{tx('changesBtn')}</button></div></section>}

    {can.release&&held&&<section className="sx-card gx-card" aria-labelledby="gx-release"><h2 id="gx-release">{tx('releaseTitle')}</h2><p className="sx-help">{tx('releaseHelp')}</p>
     {!releaseOpen&&<div className="gx-actions"><button type="button" className="sx-btn gx-danger" onClick={()=>setReleaseOpen(true)}>{tx('releaseOpen')}</button></div>}
     {releaseOpen&&<div role="group" aria-labelledby="gx-rel-h" className="gx-confirmbox"><h3 id="gx-rel-h">{tx('releaseConfirmTitle')}</h3>
      <dl className="gx-dl"><dt>{tx('releaseTarget')}</dt><dd>{g.groupNumber} · {g.label}</dd><dt>{tx('people')}</dt><dd>{g.memberCount}</dd><dt>{tx('releaseWhen')}</dt><dd>{g.period.startDate}{g.period.endDate!==g.period.startDate?' – '+g.period.endDate:''} · {storeName(ja,g.pickupStore)}</dd><dt>{tx('releaseEquip')}</dt><dd>{itemSummary}</dd><dt>{tx('releaseResult')}</dt><dd>{tx('releaseEffect')}</dd></dl>
      <label className="gx-field">{tx('releaseReason')}<textarea rows={2} maxLength={300} value={releaseReason} onChange={e=>setReleaseReason(e.target.value)}/></label>
      <label className="gx-field">{tx('releaseMsg')}<textarea rows={2} maxLength={2000} value={releaseMsg} onChange={e=>setReleaseMsg(e.target.value)}/></label>
      <div className="gx-actions"><button type="button" className="sx-btn gx-danger" disabled={busy||!releaseReason.trim()} onClick={()=>void releaseNow()}>{tx('releaseRun')}</button>
       <button type="button" className="sx-btn" disabled={busy} onClick={()=>setReleaseOpen(false)}>{tx('releaseCancel')}</button></div></div>}
    </section>}

    {status==='CONFIRMED'&&<section className="sx-card gx-card" aria-labelledby="gx-pay"><h2 id="gx-pay">{tx('payTitle')}</h2><p className="sx-help">{tx('payHelp')}</p>
     {can.payment&&<form className="gx-form" noValidate onSubmit={e=>{e.preventDefault();void record();}}>
      <label className="gx-field">{tx('payAmount')}<input inputMode="numeric" value={pay.amount} onChange={e=>setPay(o=>({...o,amount:e.target.value}))}/></label>
      <label className="gx-field">{tx('payMethod')}<select value={pay.method} onChange={e=>setPay(o=>({...o,method:e.target.value}))}><option value="CASH">{tx('mCash')}</option><option value="CARD_AT_COUNTER">{tx('mCard')}</option><option value="OTHER_ON_SITE">{tx('mOther')}</option></select></label>
      <label className="gx-field">{tx('payAt')}<input type="datetime-local" value={pay.at} onChange={e=>setPay(o=>({...o,at:e.target.value}))}/></label>
      <label className="gx-field">{tx('payNote')}<input maxLength={300} value={pay.note} onChange={e=>setPay(o=>({...o,note:e.target.value}))}/></label>
      <div className="gx-actions"><button type="submit" className="sx-btn sx-btn--primary" disabled={busy}>{tx('payRecord')}</button></div></form>}
     <h3>{tx('payList')}</h3>{d.payments.length===0?<p className="sx-help">{tx('payNone')}</p>:<ul className="gx-list gx-pays">{d.payments.map(p=><li key={p.id}>
      <strong>{p.kind==='RECEIPT'?tx('payKindReceipt'):tx('payKindReversal')}</strong> {p.kind==='REVERSAL'?'−':''}{yen(ja,p.amountJpy)} · {p.method==='CASH'?tx('mCash'):p.method==='CARD_AT_COUNTER'?tx('mCard'):tx('mOther')} · {jstDateTime(ja,p.receivedAt)}{p.note?` · ${p.note}`:''}{p.reason?` · ${p.reason}`:''}
      {p.kind==='RECEIPT'&&reversedIds.has(p.id)&&<> · <span className="gx-badge">{tx('payReversed')}</span></>}
      {p.kind==='RECEIPT'&&!reversedIds.has(p.id)&&can.payment&&(reversing===p.id?<div className="gx-confirmbox"><label className="gx-field">{tx('payRevReason')}<input maxLength={300} value={reverseReason} onChange={e=>setReverseReason(e.target.value)}/></label>
       <div className="gx-actions"><button type="button" className="sx-btn gx-danger" disabled={busy||!reverseReason.trim()} onClick={()=>void reverse(p.id)}>{tx('payRevRun')}</button><button type="button" className="sx-btn" onClick={()=>setReversing(null)}>{tx('releaseCancel')}</button></div></div>:<> <button type="button" className="sx-link" onClick={()=>{setReversing(p.id);setReverseReason('');}}>{tx('payRev')}</button></>)}</li>)}</ul>}
    </section>}

    {can.cancel&&status==='CONFIRMED'&&<section className="sx-card gx-card" aria-labelledby="gx-cancel"><h2 id="gx-cancel">{tx('cancelTitle')}</h2><p className="sx-help">{tx('cancelHelp')}</p>
     {!cancelOpen?<div className="gx-actions"><button type="button" className="sx-btn gx-danger" onClick={()=>setCancelOpen(true)}>{tx('cancelOpen')}</button></div>:<div className="gx-confirmbox">
      {d.settlement.receivedJpy>0&&<p className="gx-warn" role="note">{tx('cancelRefund')}: {yen(ja,d.settlement.receivedJpy)}</p>}
      <label className="gx-field">{tx('cancelReason')}<textarea rows={2} maxLength={300} value={cancelReason} onChange={e=>setCancelReason(e.target.value)}/></label>
      <div className="gx-actions"><button type="button" className="sx-btn gx-danger" disabled={busy||!cancelReason.trim()} onClick={()=>void cancelNow()}>{tx('cancelRun')}</button><button type="button" className="sx-btn" onClick={()=>setCancelOpen(false)}>{tx('releaseCancel')}</button></div></div>}
    </section>}

    <section className="sx-card gx-card" aria-labelledby="gx-notif"><h2 id="gx-notif">{tx('notif')}</h2>
     {d.notifications.length===0?<p className="sx-help">{tx('notifNone')}</p>:<ul className="gx-list">{d.notifications.map((n,i)=><li key={i}>{tx(('ev.'+n.eventType) as GKey)} · <strong>{tx(('ns.'+n.status) as GKey)}</strong> · {jstDateTime(ja,n.sentAt??n.createdAt)}</li>)}</ul>}
    </section>
    <details className="sx-card gx-card"><summary>{tx('history')}</summary><ul className="gx-list">{[...d.events].reverse().map(e=><li key={e.id}>{jstDateTime(ja,e.occurred_at)} · {e.event_type} · r{e.revision}{typeof e.payload?.reason==='string'?` · ${e.payload.reason}`:''}</li>)}</ul></details>
   </div>
  </div>
 </main></StaffSessionBoundary>;
}
