'use client';
import {useEffect,useRef,useState} from 'react';
import {useStaffLocaleOr} from './staff-locale';
import {st,type StaffLocale} from './staff-i18n';
import {StaffSessionBoundary,invalidateStaffView} from './StaffSessionBoundary';
import {STORE_LABEL} from './guest-format';
import type {CouponProductOption} from '../lib/coupon-products';
import './staff-orders.css';
import './staff-sales-stops.css';
import './staff-coupons.css';

// Coupon administration. Terms are immutable once created: the only change is switching a coupon on/off. Different terms = a new code.
// Nothing is pre-filled: every business value (discount, period, scope, limits) must be entered by the administrator.
type Terms={code:string;validFrom:string;validUntil:string;storeBasis?:'PICKUP_STORE';stores:string[];products:string[];kind:'PERCENT_BPS'|'FIXED_JPY';value:number;minimumJpy:number;minimumBasis:string;maximumDiscountJpy:number;advanceCombination:string;maxActiveReservations:number|null};
type Coupon={id:string;code:string;terms:Terms;active:boolean;createdAt:string;usage:{bookings:number;activeReservations:number}};
type View={coupons:Coupon[];canEdit:boolean};
const STORES=['MOUNTAIN_BASE','ONSEN_BASE'] as const;
const L={
 intro:['お客様が予約時に入力するクーポンコードを作成・管理します。','Create and manage the coupon codes customers enter when booking.'],
 how1:['作成したクーポンの条件（割引・期間・対象店舗・対象商品・上限）は後から変更できません。','The terms of a coupon (discount, period, stations, products, limits) cannot be changed after creation.'],
 how2:['できる操作は「有効／無効」の切り替えです。無効にすると新しい予約では使えません（すでに確定した予約は変わりません）。','The only change is switching it on or off. A disabled coupon cannot be used on new bookings; confirmed bookings are not changed.'],
 how3:['条件を変えたいときは、新しいコードで作り直し、古いクーポンを無効にしてください。','To change terms, create a new coupon with a new code and disable the old one.'],
 how4:['割引の値・期間・上限などは初期値がありません。すべて入力が必要です。','There are no default values. Discount, period and limits must all be entered.'],
 viewOnly:['閲覧のみ（作成・切り替えには管理者権限が必要です）','View only (creating and switching need administrator permission)'],
 newTitle:['クーポンを作成','Create a coupon'],code:['コード（英数字とハイフン、32文字まで）','Code (letters, digits, hyphen; up to 32)'],codeHint:['大文字に統一されます','Stored in upper case'],
 from:['有効開始（日本時間）','Valid from (JST)'],until:['有効終了（日本時間・この時刻まで）','Valid until (JST, exclusive)'],
 stores:['対象店舗（受取店舗）','Stations (pickup)'],products:['対象商品','Products'],selectAll:['すべて選択','Select all'],clearAll:['選択解除','Clear'],
 kind:['割引の種類','Discount type'],kindPh:['選択してください','Select'],percent:['割合（%）','Percent (%)'],fixed:['定額（円）','Fixed amount (JPY)'],
 valuePercent:['割引率（%、小数2桁まで）','Rate (%, up to 2 decimals)'],valueFixed:['割引額（円）','Amount (JPY)'],
 minimum:['最低利用額（円）','Minimum amount (JPY)'],minBasis:['最低利用額の基準','Minimum applies to'],cart:['カート全体の小計','Cart subtotal'],eligible:['対象商品の小計','Eligible products subtotal'],
 maxDiscount:['割引上限額（円）','Maximum discount (JPY)'],advance:['前日までの事前支払割引との併用','Combination with the advance-payment discount'],
 allow:['併用できる','Allowed'],deny:['併用できない','Not allowed'],unset:['未定（併用する予約では使えません）','Undecided (unusable on such bookings)'],
 limit:['同時に確保できる予約数の上限','Limit on simultaneously reserved bookings'],noLimit:['上限なし','No limit'],
 create:['クーポンを作成','Create coupon'],confirmCreate:['このクーポンを作成します。作成後は条件を変更できません。よろしいですか？','This coupon will be created. Its terms cannot be changed afterwards. Continue?'],
 created:['クーポンを作成しました。','Coupon created.'],
 invalid:['入力内容を確認してください（未入力の項目、期間、数値の範囲）。','Check the form (empty fields, period, number ranges).'],
 exists:['このコードはすでに使われています。別のコードを入力してください。','This code already exists. Enter a different code.'],
 forbidden:['この操作の権限がありません。','You do not have permission for this.'],failed:['保存できませんでした。もう一度お試しください。','Could not save. Please try again.'],
 listTitle:['クーポン一覧','Coupons'],none:['クーポンはまだありません。','No coupons yet.'],loadFailed:['読み込めませんでした。','Could not load.'],retry:['再読み込み','Retry'],
 cCode:['コード','Code'],cDiscount:['割引','Discount'],cPeriod:['有効期間','Period'],cScope:['対象','Scope'],cLimit:['上限','Limits'],cUsage:['利用状況','Usage'],cState:['状態','State'],cCreated:['作成日','Created'],
 on:['有効','Active'],off:['無効','Disabled'],enable:['有効にする','Enable'],disable:['無効にする','Disable'],
 confirmOff:['を無効にします。新しい予約では使えなくなります。よろしいですか？','will be disabled and cannot be used on new bookings. Continue?'],confirmOn:['を有効にします。よろしいですか？','will be enabled. Continue?'],
 switched:['状態を変更しました。','State changed.'],
 minLabel:['最低','Min'],maxLabel:['割引上限','Cap'],maxRes:['同時予約上限','Reserved max'],unlimited:['なし','none'],
 bookings:['予約','bookings'],holding:['確保中','held'],items:['商品','products'],all:['すべて','all'],
 combo:['事前割引併用','Advance combo'],
} as const;
const jst=(v:string)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(v)).replace(',','');
const toIso=(local:string)=>{const m=/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(local);if(!m)return null;const d=new Date(`${m[1]}T${m[2]}:00+09:00`);return Number.isNaN(d.getTime())?null:d.toISOString();};
const jpy=(n:number)=>'¥'+n.toLocaleString('en-US');
const int=(s:string,max:number)=>/^\d{1,12}$/.test(s.trim())&&Number(s)<=max?Number(s):null;
const EMPTY={code:'',from:'',until:'',stores:[] as string[],products:[] as string[],kind:'',value:'',minimum:'',minBasis:'',maxDiscount:'',advance:'',limit:'',noLimit:false};

export function StaffCoupons({locale:serverLocale,stamp,products}:{locale:StaffLocale;stamp:string;products:CouponProductOption[]}){
 const locale=useStaffLocaleOr(serverLocale),en=locale==='en',tx=(k:keyof typeof L)=>L[k][en?1:0];
 const [data,setData]=useState<View|null>(null),[loadFailed,setLoadFailed]=useState(false),[reload,setReload]=useState(0),gen=useRef(0);
 const [f,setF]=useState(EMPTY),[busy,setBusy]=useState(false),[msg,setMsg]=useState<{kind:'ok'|'err';text:string}|null>(null),pending=useRef<{key:string;body:string}|null>(null);
 useEffect(()=>{const ticket=++gen.current;queueMicrotask(async()=>{
  try{const r=await fetch('/api/coupons',{cache:'no-store',headers:{'x-zao-session':stamp}});if(r.status===401){invalidateStaffView();return;}if(!r.ok)throw Error();const v=await r.json() as View;if(ticket===gen.current){setData(v);setLoadFailed(false);}}
  catch{if(ticket===gen.current)setLoadFailed(true);}
 });},[stamp,reload]);
 const label=(s:string)=>STORE_LABEL[s]??s,pname=(k:string)=>{const p=products.find(x=>x.key===k);return p?(en?p.en:p.ja):k;};
 const set=<K extends keyof typeof EMPTY>(k:K,v:(typeof EMPTY)[K])=>setF(o=>({...o,[k]:v}));
 const toggle=(k:'stores'|'products',v:string,on:boolean)=>setF(o=>({...o,[k]:on?[...o[k],v]:o[k].filter(x=>x!==v)}));
 const errText=(status:number,code?:string)=>code==='COUPON_CODE_EXISTS'?tx('exists'):status===403?tx('forbidden'):status===422||status===400||code==='INVALID_COUPON'||code==='INVALID_INPUT'?tx('invalid'):tx('failed');
 const build=():Terms|null=>{
  const validFrom=toIso(f.from),validUntil=toIso(f.until);if(!validFrom||!validUntil||validFrom>=validUntil)return null;
  if(!/^[A-Za-z0-9-]{1,32}$/.test(f.code.trim())||!f.stores.length||!f.products.length||!f.minBasis||!f.advance)return null;
  let value:number|null=null;
  if(f.kind==='PERCENT_BPS'){if(/^\d{1,3}(\.\d{1,2})?$/.test(f.value.trim())){const b=Math.round(parseFloat(f.value)*100);if(b>=1&&b<=10000)value=b;}}
  else if(f.kind==='FIXED_JPY')value=int(f.value,100_000_000);
  const minimumJpy=int(f.minimum,100_000_000),maximumDiscountJpy=int(f.maxDiscount,100_000_000);
  let maxActiveReservations:number|null=null;if(!f.noLimit){maxActiveReservations=int(f.limit,100000);if(!maxActiveReservations||maxActiveReservations<1)return null;}
  if(value===null||value<1||minimumJpy===null||maximumDiscountJpy===null)return null;
  return {code:f.code.trim().toUpperCase(),validFrom,validUntil,storeBasis:'PICKUP_STORE',stores:[...f.stores].sort(),products:[...f.products],kind:f.kind as Terms['kind'],value,minimumJpy,minimumBasis:f.minBasis,maximumDiscountJpy,advanceCombination:f.advance,maxActiveReservations};
 };
 const post=async(input:unknown,body:string)=>{
  if(!pending.current||pending.current.body!==body)pending.current={key:crypto.randomUUID(),body};
  const r=await fetch('/api/coupons',{method:'POST',headers:{'content-type':'application/json','x-zao-session':stamp},body:JSON.stringify({requestKey:pending.current.key,input})});
  if(r.status===401){invalidateStaffView();return null;}
  const v=await r.json().catch(()=>({})) as {error?:string};if(r.status!==409||v.error==='COUPON_CODE_EXISTS')pending.current=null;
  return {ok:r.ok,status:r.status,code:v.error};
 };
 const submit=async()=>{
  setMsg(null);const terms=build();if(!terms){setMsg({kind:'err',text:tx('invalid')});return;}
  if(!window.confirm(`${terms.code}\n${tx('confirmCreate')}`))return;
  setBusy(true);
  try{const input={operation:'create',terms};const a=await post(input,JSON.stringify(input));if(!a)return;
   if(!a.ok){setMsg({kind:'err',text:errText(a.status,a.code)});return;}
   setMsg({kind:'ok',text:tx('created')});setF(EMPTY);setReload(n=>n+1);
  }catch{setMsg({kind:'err',text:tx('failed')});}finally{setBusy(false);}
 };
 const switchActive=async(c:Coupon)=>{
  setMsg(null);const active=!c.active;
  if(!window.confirm(`${c.code} ${tx(active?'confirmOn':'confirmOff')}`))return;
  setBusy(true);
  try{const input={operation:'setActive',couponId:c.id,active,reason:null};const a=await post(input,JSON.stringify(input));if(!a)return;
   if(!a.ok){setMsg({kind:'err',text:errText(a.status,a.code)});return;}
   setMsg({kind:'ok',text:tx('switched')});setReload(n=>n+1);
  }catch{setMsg({kind:'err',text:tx('failed')});}finally{setBusy(false);}
 };
 const discount=(t:Terms)=>t.kind==='PERCENT_BPS'?`${t.value/100}%`:jpy(t.value);
 const date=(v:string)=>new Intl.DateTimeFormat(en?'en-GB':'ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'short',day:'numeric'}).format(new Date(v));
 const comboLabel=(v:string)=>tx(v==='ALLOW'?'allow':v==='DENY'?'deny':'unset');
 return <StaffSessionBoundary stamp={stamp}><main className="ox">
  <div className="ox-head"><h1>{st(locale,'coupons')}</h1></div>
  <p className="sx-help">{tx('intro')}</p>
  <section className="sx-card cp-card" aria-labelledby="cp-howto"><h2 id="cp-howto">{en?'How it works':'使い方'}</h2>
   <ul className="cp-howto"><li>{tx('how1')}</li><li>{tx('how2')}</li><li>{tx('how3')}</li><li>{tx('how4')}</li></ul></section>
  {data&&!data.canEdit&&<p className="sx-status">{tx('viewOnly')}</p>}
  {data?.canEdit&&<section className="sx-card cp-card" aria-labelledby="cp-new"><h2 id="cp-new">{tx('newTitle')}</h2>
   <form className="cp-form" noValidate onSubmit={e=>{e.preventDefault();void submit();}}>
    <label>{tx('code')}<input type="text" maxLength={32} autoComplete="off" value={f.code} onChange={e=>set('code',e.target.value)}/><span className="cp-hint">{tx('codeHint')}</span></label>
    <label>{tx('from')}<input type="datetime-local" value={f.from} onChange={e=>set('from',e.target.value)}/></label>
    <label>{tx('until')}<input type="datetime-local" value={f.until} onChange={e=>set('until',e.target.value)}/></label>
    <fieldset><legend>{tx('stores')}</legend>{STORES.map(s=><label key={s} className="cp-check"><input type="checkbox" checked={f.stores.includes(s)} onChange={e=>toggle('stores',s,e.target.checked)}/>{label(s)}</label>)}</fieldset>
    <fieldset><legend>{tx('products')}</legend>
     <div className="cp-actions" style={{width:'100%',margin:'0 0 4px'}}><button type="button" className="sx-btn" onClick={()=>set('products',products.map(p=>p.key))}>{tx('selectAll')}</button><button type="button" className="sx-btn" onClick={()=>set('products',[])}>{tx('clearAll')}</button></div>
     {products.map(p=><label key={p.key} className="cp-check"><input type="checkbox" checked={f.products.includes(p.key)} onChange={e=>toggle('products',p.key,e.target.checked)}/>{en?p.en:p.ja}</label>)}</fieldset>
    <label>{tx('kind')}<select value={f.kind} onChange={e=>set('kind',e.target.value)}><option value="">{tx('kindPh')}</option><option value="PERCENT_BPS">{tx('percent')}</option><option value="FIXED_JPY">{tx('fixed')}</option></select></label>
    <label>{f.kind==='FIXED_JPY'?tx('valueFixed'):tx('valuePercent')}<input type="text" inputMode="decimal" value={f.value} onChange={e=>set('value',e.target.value)}/></label>
    <label>{tx('minimum')}<input type="text" inputMode="numeric" value={f.minimum} onChange={e=>set('minimum',e.target.value)}/></label>
    <label>{tx('minBasis')}<select value={f.minBasis} onChange={e=>set('minBasis',e.target.value)}><option value="">{tx('kindPh')}</option><option value="CART_SUBTOTAL">{tx('cart')}</option><option value="ELIGIBLE_SUBTOTAL">{tx('eligible')}</option></select></label>
    <label>{tx('maxDiscount')}<input type="text" inputMode="numeric" value={f.maxDiscount} onChange={e=>set('maxDiscount',e.target.value)}/></label>
    <label>{tx('advance')}<select value={f.advance} onChange={e=>set('advance',e.target.value)}><option value="">{tx('kindPh')}</option><option value="ALLOW">{tx('allow')}</option><option value="DENY">{tx('deny')}</option><option value="UNSET">{tx('unset')}</option></select></label>
    <label>{tx('limit')}<input type="text" inputMode="numeric" disabled={f.noLimit} value={f.noLimit?'':f.limit} onChange={e=>set('limit',e.target.value)}/>
     <span className="cp-check"><input type="checkbox" checked={f.noLimit} onChange={e=>set('noLimit',e.target.checked)}/>{tx('noLimit')}</span></label>
    <div className="cp-actions" style={{gridColumn:'1/-1'}}><button type="submit" className="sx-btn sx-btn--primary" disabled={busy}>{tx('create')}</button></div>
   </form>
  </section>}
  {msg&&<p className={msg.kind==='ok'?'sx-status':'sx-alert'} role={msg.kind==='ok'?'status':'alert'}>{msg.text}</p>}
  <section className="sx-card cp-card" aria-labelledby="cp-list"><h2 id="cp-list">{tx('listTitle')}</h2>
   {loadFailed&&<p className="sx-alert" role="alert">{tx('loadFailed')} <button type="button" className="sx-link" onClick={()=>setReload(n=>n+1)}>{tx('retry')}</button></p>}
   {!data&&!loadFailed&&<p className="sx-status" role="status">…</p>}
   {data&&!data.coupons.length&&<p className="sx-empty">{tx('none')}</p>}
   {data&&data.coupons.length>0&&<div className="ox-table-wrap"><table className="sx-table ox-table"><thead><tr><th>{tx('cCode')}</th><th>{tx('cDiscount')}</th><th>{tx('cPeriod')}</th><th>{tx('cScope')}</th><th>{tx('cLimit')}</th><th>{tx('cUsage')}</th><th>{tx('cState')}</th><th>{tx('cCreated')}</th></tr></thead>
    <tbody>{data.coupons.map(c=><tr key={c.id}><td><strong>{c.code}</strong></td><td>{discount(c.terms)}</td>
     <td>{jst(c.terms.validFrom)}<br/>〜 {jst(c.terms.validUntil)}</td>
     <td className="cp-cell-list">{c.terms.stores.map(label).join('・')}<br/>{c.terms.products.length===products.length?`${tx('items')}: ${tx('all')}`:c.terms.products.map(pname).join(', ')}</td>
     <td className="cp-cell-list">{tx('minLabel')} {jpy(c.terms.minimumJpy)}<br/>{tx('maxLabel')} {jpy(c.terms.maximumDiscountJpy)}<br/>{tx('maxRes')}: {c.terms.maxActiveReservations??tx('unlimited')}<br/>{tx('combo')}: {comboLabel(c.terms.advanceCombination)}</td>
     <td>{c.usage.bookings}{en?' ':''}{tx('bookings')}<br/>{c.usage.activeReservations}{en?' ':''}{tx('holding')}</td>
     <td><span className={'cp-badge'+(c.active?' cp-badge--on':'')}>{tx(c.active?'on':'off')}</span>{data.canEdit&&<><br/><button type="button" className="sx-btn" disabled={busy} onClick={()=>void switchActive(c)}>{tx(c.active?'disable':'enable')}</button></>}</td>
     <td>{date(c.createdAt)}</td></tr>)}</tbody></table></div>}
  </section>
 </main></StaffSessionBoundary>;
}
