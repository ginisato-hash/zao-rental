'use client';
import {memo,useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {GROUP_COPY,type GroupCopy} from './group-copy';
import {fitBadge,fitNotice,fitManualNotice} from './fit-copy';
import {storeName,yen} from './guest-format';
import {profileFields} from '../../../../packages/contracts/src/profile-fields';
import {GROUP_CSV_MAX_ROWS,describeGroupCsvIssue,diffGroupCsv,parseGroupCsv,serializeGroupCsvRows,type GroupCsvCatalog,type GroupCsvDiff,type GroupCsvMemberValues,type GroupCsvRow,type ImportMode} from '../../../../packages/contracts/src/group-csv';
import type {FitMeta} from '../../../../packages/contracts/src/size-edge';
import type {Locale} from '../../../../packages/core/src/content/public-pages';
import './public.css';
import './guest.css';
import './group.css';

type Direction='RECOMMENDED'|'SHORTER'|'LONGER';
type ERow=GroupCsvMemberValues&{uid:string;memberId:string|null;baseline:GroupCsvMemberValues|null};
type Cand={lengthCm:number;sizeLabel?:string;fit?:FitMeta}|null;
type Advice={index:number;state:'READY'|'EDGE'|'MANUAL_FIT_REQUIRED'|'SHORT'|'INVALID'|'UNAVAILABLE';reason:string|null;candidates:Record<Direction,Cand>;defaultDirection:Direction|null;manualFit?:{fit:FitMeta;lengthCm:number;sizeLabel?:string}};
type AdviceResult={sig:string;advice:Advice[];summary:{members:number;ready:number;edge:number;short:number;manual:number;invalid:number};joint:string};
type QuoteLine={memberId:string;ordinal:number;items:{productKey:string;duration:string;unitJpy:number;lineJpy:number;bundleDiscountJpy:number}[];baseJpy:number;memberDiscountJpy:number;groupDiscountJpy:number;finalJpy:number};
type Quote={id:string;groupRevision:number;totalJpy:number;subtotalJpy:number;bundleDiscountJpy:number;memberDiscountJpy:number;groupDiscountJpy:number;lines:QuoteLine[];digest:string};
type View={group:{id:string;groupNumber:string;status:string;revision:number;label:string;pickupStore:string;period:{startDate:string;endDate:string;startAt?:string;returnBy?:string};memberCount:number;confirmedTotalJpy:number|null;locale:string};rows:{memberId:string;ordinal:number;label:string;row:GroupCsvMemberValues|null;direction:Direction;fit:{requiresStoreConfirmation?:boolean}}[];estimate:Quote|null;finalQuote:Quote|null;consented:boolean;settlement:{status:string};requests:{kind:'CHANGE'|'DECLINE';status:string}[]};
type Catalog={csv:GroupCsvCatalog;models:{code:string;name:string;sport:string}[];terms:{version:string}};
type Api={ok:boolean;status:number;data:Record<string,unknown>&{error?:string}};

const uuid=()=>crypto.randomUUID();
let uidCounter=0;const nextUid=()=>'x'+(++uidCounter);
const blank=():ERow=>({uid:nextUid(),memberId:null,baseline:null,label:null,sport:'SKI',equipment:{kind:'SET'},tier:'REGULAR',ageAtStart:null,adultAtStart:null,heightCm:null,weightKg:null,footCm:null,skierType:null,premiumModelCode:null,jacketSize:null,pantsSize:null,wearSport:null,wearAddon:false});
const values=(r:ERow):GroupCsvMemberValues=>{const {uid:_u,memberId:_m,baseline:_b,...v}=r;void _u;void _m;void _b;return v;};
const payloadRows=(rows:ERow[])=>rows.map(r=>({...values(r),memberId:r.memberId}));
const SPORT_ITEMS:Record<string,string[]>={SKI:['SKI','SKI_BOOT','POLE'],SNOWBOARD:['SNOWBOARD','SNOWBOARD_BOOT']};
const SKIERS=['TYPE_I','TYPE_II','TYPE_III'] as const;
/** Keeps a row internally consistent: fields the chosen equipment does not use are cleared (no hidden stale values). */
function tidy(r:ERow):ERow{
 const o={...r};
 if(o.sport==='WEAR'){o.equipment={kind:'NONE'};o.tier='STANDARD';o.heightCm=null;o.weightKg=null;o.footCm=null;o.skierType=null;o.premiumModelCode=null;o.wearAddon=false;o.wearSport=o.wearSport??'SKI';return o;}
 if(o.tier==='STANDARD')o.tier='REGULAR';
 if(o.equipment.kind==='NONE')o.equipment={kind:'SET'};
 if(o.equipment.kind==='ITEMS'){const allowed=SPORT_ITEMS[o.sport]!;o.equipment={kind:'ITEMS',items:o.equipment.items.filter(i=>allowed.includes(i))};}
 const need=profileFields(o.sport,undefined,o.equipment.kind==='ITEMS'?o.equipment.items:undefined);
 if(!need.height)o.heightCm=null;if(!need.foot)o.footCm=null;if(!need.ski){o.weightKg=null;o.skierType=null;}
 if(o.tier!=='PREMIUM')o.premiumModelCode=null;
 if(!o.wearAddon){o.jacketSize=null;o.pantsSize=null;o.wearSport=null;}else o.wearSport=o.wearSport??(o.sport==='SNOWBOARD'?'SNOWBOARD':'SKI');
 o.adultAtStart=o.ageAtStart===null?null:o.ageAtStart>=13;
 return o;
}
const sigOf=(rows:ERow[])=>JSON.stringify(rows.map(values));
function validate(rows:ERow[],cat:GroupCsvCatalog,lang:'JA'|'EN',t:GroupCopy){
 const out=new Map<number,string[]>(),push=(i:number,m:string)=>{const a=out.get(i)??[];if(!a.includes(m))a.push(m);out.set(i,a);};let global=false;
 if(!rows.length)return {byRow:out,global};
 const res=parseGroupCsv(serializeGroupCsvRows(rows.map(r=>({...values(r),memberId:null})),'EN'),cat,{allowCp932:false});
 if(!res.ok)for(const e of res.errors){if(e.line===null){global=true;continue;}push(e.line-2,describeGroupCsvIssue({...e,line:null},lang));}
 rows.forEach((r,i)=>{if(r.ageAtStart===null)push(i,t.rows.ageNeeded);});
 return {byRow:out,global};
}
function download(name:string,body:Blob){const url=URL.createObjectURL(body),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
const store=(k:string,v?:string)=>{try{if(v===undefined)return sessionStorage.getItem(k);if(v==='')sessionStorage.removeItem(k);else sessionStorage.setItem(k,v);}catch{}return null;};
const days=(p:{startDate:string;endDate:string})=>Math.round((Date.parse(p.endDate)-Date.parse(p.startDate))/86400000)+1;
const PRODUCT:Record<string,[string,string]>={SKI_SET:['スキーセット','Ski set'],SNOWBOARD_SET:['ボードセット','Board set'],SKI:['スキー板','Skis'],SKI_BOOT:['スキーブーツ','Ski boots'],POLE:['ポール','Poles'],SNOWBOARD:['スノーボード','Snowboard'],SNOWBOARD_BOOT:['ボードブーツ','Board boots'],WEAR_SET:['ウェア','Wear'],WEAR_JACKET:['ジャケット','Jacket'],WEAR_PANTS:['パンツ','Pants']};

export function GroupApplication({locale,token,groupId,legal}:{locale:Locale;token:string;groupId:string|null;legal?:{terms?:string|undefined;cancellation?:string|undefined}}){
 const ja=locale==='ja',t=GROUP_COPY[locale],lang=ja?'JA' as const:'EN' as const;
 const [phase,setPhase]=useState<'loading'|'closed'|'noaccess'|'form'|'work'>('loading');
 const [catalog,setCatalog]=useState<Catalog|null>(null);
 const [view,setView]=useState<View|null>(null);
 const [step,setStep]=useState(1);
 const [rows,setRows]=useState<ERow[]>([]);
 const [adviceRes,setAdviceRes]=useState<AdviceResult|null>(null);
 const [directions,setDirections]=useState<Record<string,Direction>>({});
 const [busy,setBusy]=useState<string|null>(null);
 const [error,setError]=useState<string|null>(null);
 const [resumeKey,setResumeKey]=useState<string|null>(null);
 const [planned,setPlanned]=useState<number|null>(null);
 const inflight=useRef(false),heading=useRef<HTMLHeadingElement>(null),gid=useRef<string|null>(groupId);
 const call=useCallback(async(path:string,body?:unknown):Promise<Api>=>{
  try{const r=await fetch('/api/group'+path,{method:body===undefined?'GET':'POST',cache:'no-store',credentials:'same-origin',headers:{'x-group-entrance':token,...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
   let data:Api['data']={};try{data=await r.json();}catch{}return {ok:r.ok,status:r.status,data};}
  catch{return {ok:false,status:0,data:{error:'NETWORK'}};}
 },[token]);
 const say=useCallback((data:Api['data'])=>{const code=data.error??'';setError((t.err as Record<string,string>)[code]??t.generic);},[t]);
 /** Run one exclusive action: a second click while it runs is ignored (no duplicate calls). */
 const exclusive=useCallback(async(name:string,fn:()=>Promise<void>)=>{if(inflight.current)return;inflight.current=true;setBusy(name);setError(null);try{await fn();}finally{inflight.current=false;setBusy(null);}},[]);

 // ---- load
 const applyView=useCallback((v:View)=>{
  setView(v);
  const status=v.group.status;
  const restored:ERow[]=v.rows.filter(r=>r.row).map(r=>({...tidy({...(r.row as GroupCsvMemberValues),uid:nextUid(),memberId:r.memberId,baseline:r.row}as ERow)}));
  setRows(prev=>prev.length&&['DRAFT'].includes(status)&&!restored.length?prev:restored);
  setDirections(Object.fromEntries(restored.map(r=>[r.uid,v.rows.find(x=>x.memberId===r.memberId)?.direction??'RECOMMENDED'])));
  setStep(['DRAFT'].includes(status)?2:status==='QUOTED'?4:5);
 },[]);
 useEffect(()=>{let live=true;(async()=>{
  const cat=await call('/catalog');if(!live)return;
  if(!cat.ok){setPhase('closed');return;}
  setCatalog(cat.data as unknown as Catalog);
  if(!groupId){setPhase('form');return;}
  const hash=new URLSearchParams(location.hash.replace(/^#/,'')).get('k');
  if(hash){const s=await call('/session',{groupId,secret:hash});history.replaceState(null,'',location.pathname);if(!s.ok){setPhase('noaccess');return;}}
  const v=await call('/g/'+groupId);if(!live)return;
  if(!v.ok){setPhase('noaccess');return;}
  const pv=store('zao-group-planned:'+groupId);if(pv)setPlanned(Number(pv));
  const saved=store('zao-group-rows:v1:'+groupId);
  applyView(v.data as unknown as View);
  if(saved&&(v.data as unknown as View).group.status==='DRAFT'&&!(v.data as unknown as View).rows.length){try{const list=JSON.parse(saved) as GroupCsvMemberValues[];if(Array.isArray(list))setRows(list.slice(0,GROUP_CSV_MAX_ROWS).map(r=>tidy({...blank(),...r})));}catch{}}
  setPhase('work');
 })();return ()=>{live=false;};},[call,groupId,applyView]);
 useEffect(()=>{heading.current?.focus();},[step,phase]);
 // unsaved rows survive a reload in this tab only (sessionStorage); cleared on submit
 useEffect(()=>{if(phase==='work'&&gid.current&&view&&['DRAFT','QUOTED'].includes(view.group.status))store('zao-group-rows:v1:'+gid.current,rows.length?JSON.stringify(rows.map(values)):'');},[rows,phase,view]);

 const csv=catalog?.csv;
 const check=useMemo(()=>csv?validate(rows,csv,lang,t):{byRow:new Map<number,string[]>(),global:false},[rows,csv,lang,t]);
 const sig=useMemo(()=>sigOf(rows),[rows]);
 const adviceFresh=adviceRes?.sig===sig;
 const adviceByUid=useMemo(()=>{const m=new Map<string,Advice>();if(adviceRes&&adviceFresh)rows.forEach((r,i)=>{const a=adviceRes.advice[i];if(a)m.set(r.uid,a);});return m;},[adviceRes,adviceFresh,rows]);
 const edit=useCallback((uid:string,patch:Partial<ERow>)=>{setRows(rs=>rs.map(r=>r.uid===uid?tidy({...r,...patch}):r));},[]);

 // ---- step 1: start
 const [f,setF]=useState({groupLabel:'',contactName:'',contactEmail:'',contactPhone:'',locale:locale as string,store:'MOUNTAIN_BASE',startDate:'',endDate:'',startAt:'08:30',returnBy:'17:00',people:'10'});
 const startKey=useRef(uuid());
 const [fieldErr,setFieldErr]=useState<Record<string,string>>({});
 const submitStart=()=>exclusive('start',async()=>{
  const e:Record<string,string>={};
  if(!f.groupLabel.trim())e.groupLabel=t.err.INVALID_INPUT;if(!f.contactName.trim())e.contactName=t.err.INVALID_INPUT;
  if(!/^[^\s@]{1,64}@[^\s@]{1,190}$/.test(f.contactEmail.trim()))e.contactEmail=t.err.INVALID_INPUT;
  if(!f.startDate)e.startDate=t.err.INVALID_PERIOD;if(!f.endDate||f.endDate<f.startDate)e.endDate=t.err.INVALID_PERIOD;
  const n=Number(f.people);if(!Number.isInteger(n)||n<1||n>100)e.people=t.err.GROUP_TOO_LARGE;
  setFieldErr(e);if(Object.keys(e).length){document.getElementById('group-f-'+Object.keys(e)[0])?.focus();return;}
  const r=await call('/start',{requestKey:startKey.current,groupLabel:f.groupLabel.trim(),contactName:f.contactName.trim(),contactEmail:f.contactEmail.trim(),...(f.contactPhone.trim()?{contactPhone:f.contactPhone.trim()}:{}),locale:f.locale,pickupStore:f.store,returnStore:f.store,period:{startDate:f.startDate,endDate:f.endDate,startAt:f.startAt,returnBy:f.returnBy}});
  if(!r.ok){say(r.data);return;}
  const d=r.data as {groupId:string;resumeKey:string};gid.current=d.groupId;setResumeKey(d.resumeKey);setPlanned(n);store('zao-group-planned:'+d.groupId,String(n));
  history.replaceState(null,'','/'+locale+'/group/'+token+'/'+d.groupId);
  const v=await call('/g/'+d.groupId);if(!v.ok){say(v.data);return;}
  applyView(v.data as unknown as View);setPhase('work');startKey.current=uuid();
 });

 // ---- step 2: rows, CSV
 const [filter,setFilter]=useState<'all'|'check'|'short'>('all');
 const [selected,setSelected]=useState<Set<string>>(new Set());
 const [confirmDel,setConfirmDel]=useState<string|null>(null);
 const [mode,setMode]=useState<ImportMode>('REPLACE');
 const [imp,setImp]=useState<{errors:string[];more:number;diff:GroupCsvDiff|null;rows:GroupCsvRow[];name:string}|null>(null);
 const addRow=()=>setRows(rs=>rs.length>=GROUP_CSV_MAX_ROWS?rs:[...rs,blank()]);
 const copyRow=(uid:string)=>setRows(rs=>{if(rs.length>=GROUP_CSV_MAX_ROWS)return rs;const i=rs.findIndex(r=>r.uid===uid);if(i<0)return rs;const src=rs[i]!,c:ERow={...src,uid:nextUid(),memberId:null,baseline:null,label:src.label?([...src.label+' 2'].slice(0,40)).join(''):null};return [...rs.slice(0,i+1),c,...rs.slice(i+1)];});
 const delRow=(uid:string)=>{setRows(rs=>rs.filter(r=>r.uid!==uid));setSelected(s=>{const n=new Set(s);n.delete(uid);return n;});setConfirmDel(null);};
 const [bulk,setBulk]=useState<{field:'tier'|'wearAddon'|'jacketSize'|'pantsSize';value:string}>({field:'tier',value:'REGULAR'});
 const applyBulk=()=>{setRows(rs=>rs.map(r=>{if(!selected.has(r.uid))return r;const p:Partial<ERow>=bulk.field==='tier'?{tier:bulk.value as ERow['tier']}:bulk.field==='wearAddon'?{wearAddon:bulk.value==='YES'}:bulk.field==='jacketSize'?{jacketSize:bulk.value||null,wearAddon:r.sport==='WEAR'?false:true}:{pantsSize:bulk.value||null,wearAddon:r.sport==='WEAR'?false:true};return tidy({...r,...p});}));};
 const template=(kind:'empty'|'example'|'legend')=>exclusive('dl',async()=>{try{const r=await fetch(`/api/group/template/${locale}/${kind}`,{cache:'no-store',headers:{'x-group-entrance':token}});if(!r.ok){setError(t.generic);return;}const cd=/filename="([^"]+)"/.exec(r.headers.get('content-disposition')??'');download(cd?.[1]??`group-${kind}.csv`,await r.blob());}catch{setError(t.generic);}});
 const exportCurrent=()=>download(`group-guests-${locale}-current.csv`,new Blob([serializeGroupCsvRows(rows.map(r=>({...values(r),memberId:r.memberId})),lang)],{type:'text/csv;charset=utf-8'}));
 const onFile=async(file:File|undefined)=>{
  setImp(null);if(!file||!csv)return;
  if(file.size>1024*1024){setImp({errors:[describeGroupCsvIssue({code:'FILE_TOO_LARGE',line:null,column:null},lang)],more:0,diff:null,rows:[],name:''});return;}
  const res=parseGroupCsv(new Uint8Array(await file.arrayBuffer()),csv);
  if(!res.ok){setImp({errors:res.errors.slice(0,20).map(e=>describeGroupCsvIssue(e,lang)),more:Math.max(0,res.errors.length-20),diff:null,rows:[],name:file.name});return;}
  const existing=rows.map(r=>({memberId:r.memberId??r.uid,current:values(r),baseline:r.baseline}));
  setImp({errors:[],more:0,diff:diffGroupCsv(existing,res.rows,mode),rows:res.rows,name:file.name});
 };
 const applyImport=()=>{
  if(!imp?.diff||imp.diff.counts.CONFLICT>0)return;
  const byId=new Map(rows.map(r=>[r.memberId??r.uid,r])),incoming=new Map(imp.rows.map(r=>[r.line,r]));
  const next:ERow[]=[];
  if(imp.diff.mode==='ADD')next.push(...rows);
  for(const e of imp.diff.entries){
   if(e.kind==='ADD'){const {line:_l,memberId:_m,...v}=e.incoming;void _l;void _m;next.push(tidy({...blank(),...v,baseline:v}));}
   else if(e.kind==='CHANGE'||e.kind==='UNCHANGED'){const cur=byId.get(e.memberId);const inc=incoming.get(e.line);if(cur&&inc){const {line:_l,memberId:_m,...v}=inc;void _l;void _m;const merged:ERow={...cur};if(e.kind==='CHANGE')for(const c of e.changes)(merged as Record<string,unknown>)[c.field]=c.to;next.push(tidy({...merged,baseline:{...(cur.baseline??values(cur)),...Object.fromEntries((e.kind==='CHANGE'?e.changes:[]).map(c=>[c.field,v[c.field]]))}}));}}
  }
  setRows(next.slice(0,GROUP_CSV_MAX_ROWS));setImp(null);setAdviceRes(null);
 };
 const needsCheck=(r:ERow)=>check.byRow.has(rows.indexOf(r))||['INVALID','MANUAL_FIT_REQUIRED','EDGE'].includes(adviceByUid.get(r.uid)?.state??'');
 const isShort=(r:ERow)=>['SHORT','UNAVAILABLE'].includes(adviceByUid.get(r.uid)?.state??'');
 const rowIndex=useMemo(()=>new Map(rows.map((r,i)=>[r.uid,i])),[rows]);
 const shown=rows.filter(r=>filter==='all'||(filter==='check'?(check.byRow.has(rowIndex.get(r.uid)!)||['INVALID','MANUAL_FIT_REQUIRED','EDGE'].includes(adviceByUid.get(r.uid)?.state??'')):isShort(r)));
 void needsCheck;
 const checkCount=rows.filter(r=>check.byRow.has(rowIndex.get(r.uid)!)||['INVALID','MANUAL_FIT_REQUIRED','EDGE'].includes(adviceByUid.get(r.uid)?.state??'')).length,shortCount=rows.filter(isShort).length;
 const canAdvise=rows.length>0&&check.byRow.size===0&&!check.global;

 // ---- step 3: advice
 const runAdvice=()=>exclusive('advise',async()=>{
  if(!view)return;const r=await call('/g/'+view.group.id+'/advise',{rows:payloadRows(rows)});
  if(!r.ok){say(r.data);return;}
  const d=r.data as unknown as {ok:boolean;advice?:Advice[];summary?:AdviceResult['summary'];joint?:string;issues?:unknown[]};
  if(!d.ok||!d.advice||!d.summary){setError(t.err.ROWS_INVALID);return;}
  setAdviceRes({sig:sigOf(rows),advice:d.advice,summary:d.summary,joint:d.joint??''});
  setDirections(Object.fromEntries(rows.map((row,i)=>[row.uid,d.advice![i]!.defaultDirection??'RECOMMENDED'])));
  setStep(3);
 });
 const allResolved=adviceFresh&&adviceRes!.advice.every(a=>(a.state==='READY'||a.state==='EDGE')&&a.candidates[directions[rows[a.index]!.uid]??'RECOMMENDED']);
 const saveAndQuote=()=>exclusive('save',async()=>{
  if(!view||!allResolved)return;
  const s=await call('/g/'+view.group.id+'/members',{expectedRevision:view.group.revision,rows:payloadRows(rows),directions:rows.map(r=>directions[r.uid]??'RECOMMENDED')});
  if(!s.ok){say(s.data);if(s.data.error==='ROWS_UNRESOLVED'){setAdviceRes(null);}return;}
  const sd=s.data as unknown as {revision:number;memberIds:string[]};
  setRows(rs=>rs.map((r,i)=>({...r,memberId:sd.memberIds[i]??null,baseline:values(r)})));
  const q=await call('/g/'+view.group.id+'/quote',{expectedRevision:sd.revision});
  if(!q.ok){say(q.data);return;}
  setView(q.data as unknown as View);setStep(4);
 });

 // ---- step 4: consent + submit
 const [agree,setAgree]=useState(false),[fitOk,setFitOk]=useState(false),[failed,setFailed]=useState(false);
 const submitKey=useRef<{quote:string;key:string}|null>(null);
 const anyEdge=!!view&&view.rows.some(r=>r.fit?.requiresStoreConfirmation);
 const quoteFresh=!!view?.estimate&&view.estimate.groupRevision===view.group.revision&&view.group.status==='QUOTED';
 const submit=()=>exclusive('submit',async()=>{
  if(!view||!view.estimate||!quoteFresh||!agree||(anyEdge&&!fitOk))return;
  setFailed(false);const q=view.estimate;
  if(!view.consented){const c=await call('/g/'+view.group.id+'/consent',{quoteId:q.id,digest:q.digest,explanationConfirmed:true,fitAcknowledged:anyEdge?fitOk:false});if(!c.ok){say(c.data);return;}setView(c.data as unknown as View);}
  if(!submitKey.current||submitKey.current.quote!==q.id){const saved=store('zao-group-submit:'+view.group.id+':'+q.id);submitKey.current={quote:q.id,key:saved??uuid()};store('zao-group-submit:'+view.group.id+':'+q.id,submitKey.current.key);}
  const r=await call('/g/'+view.group.id+'/submit',{requestKey:submitKey.current.key,expectedRevision:view.group.revision,quoteId:q.id});
  if(!r.ok){say(r.data);if(['INSUFFICIENT_STOCK','REQUOTE_REQUIRED','QUOTE_STALE'].includes(r.data.error??''))setFailed(true);return;}
  const nv=(r.data as unknown as {view:View}).view;store('zao-group-rows:v1:'+view.group.id,'');setView(nv);setStep(5);
 });
 const backToRows=()=>{setStep(2);setAdviceRes(null);setFailed(false);};
 const requote=()=>exclusive('requote',async()=>{
  if(!view)return;const s=await call('/g/'+view.group.id+'/members',{expectedRevision:view.group.revision,rows:payloadRows(rows),directions:rows.map(r=>directions[r.uid]??'RECOMMENDED')});
  if(!s.ok){say(s.data);return;}const q=await call('/g/'+view.group.id+'/quote',{expectedRevision:(s.data as unknown as {revision:number}).revision});if(!q.ok){say(q.data);return;}setView(q.data as unknown as View);
 });

 // ---- step 5: requests to the administrator
 const [reqKind,setReqKind]=useState<'CHANGE'|'DECLINE'>('CHANGE'),[reqBody,setReqBody]=useState(''),[reqSent,setReqSent]=useState(false);
 const sendRequest=()=>exclusive('request',async()=>{
  if(!view||!reqBody.trim())return;const r=await call('/g/'+view.group.id+'/request',{requestKey:uuid(),kind:reqKind,body:reqBody.trim()});
  if(!r.ok){say(r.data);return;}setView(r.data as unknown as View);setReqBody('');setReqSent(true);
 });
 const copy=async()=>{if(!resumeKey||!view)return;const url=location.origin+'/'+locale+'/group/'+token+'/'+view.group.id+'#k='+resumeKey;try{await navigator.clipboard.writeText(url);setReqSent(false);setCopied(true);}catch{}};
 const [copied,setCopied]=useState(false);

 // ------------------------------------------------------------------ render
 if(phase==='loading')return <p role="status" className="guest-status">{t.loading}</p>;
 const head=<><h1 ref={heading} tabIndex={-1}>{t.title}</h1></>;
 if(phase==='closed')return <>{head}<p role="alert">{t.closed}</p></>;
 if(phase==='noaccess')return <>{head}<p role="alert">{t.noAccess}</p><div className="guest-actions"><a className="group-link-button" href={'/'+locale+'/group/'+token}>{t.newApplication}</a></div></>;
 const shownStep=phase==='form'?1:step;
 const stepper=<ol className="guest-steps group-steps" aria-label={t.stepWord}>{t.steps.map((name,i)=><li key={name} className={i+1<shownStep?'guest-step--done':undefined} aria-current={i+1===shownStep?'step':undefined}><span className="guest-step-number">{i+1}</span><span className="group-step-name">{name}</span></li>)}</ol>;
 const errorBox=error&&<p role="alert" className="group-alert">{error}</p>;

 if(phase==='form'){
  const fld=(k:keyof typeof f,label:string,props:React.InputHTMLAttributes<HTMLInputElement>={})=><div className="guest-field"><label htmlFor={'group-f-'+k}><span className="guest-label-text">{label}</span><input id={'group-f-'+k} value={f[k]} onChange={e=>setF({...f,[k]:e.target.value})} aria-invalid={fieldErr[k]?true:undefined} aria-describedby={fieldErr[k]?'group-e-'+k:undefined} {...props}/></label>{fieldErr[k]&&<p id={'group-e-'+k} className="guest-field-error" role="alert">{fieldErr[k]}</p>}</div>;
  return <>{head}<p className="guest-intro">{t.intro}</p>{stepper}{errorBox}
   <form onSubmit={e=>{e.preventDefault();void submitStart();}} noValidate aria-label={t.steps[0]}>
    <fieldset><legend>{t.steps[0]}</legend>
     <div className="guest-grid">
      {fld('groupLabel',t.form.group,{maxLength:120,autoComplete:'organization'})}{fld('contactName',t.form.rep,{maxLength:120,autoComplete:'name'})}
      {fld('contactEmail',t.form.email,{type:'email',maxLength:254,autoComplete:'email'})}{fld('contactPhone',t.form.phone,{type:'tel',maxLength:40,autoComplete:'tel'})}
      <div className="guest-field"><label htmlFor="group-f-locale"><span className="guest-label-text">{t.form.lang}</span><select id="group-f-locale" value={f.locale} onChange={e=>setF({...f,locale:e.target.value})}><option value="ja">{t.form.ja}</option><option value="en">{t.form.en}</option></select></label></div>
      <div className="guest-field"><label htmlFor="group-f-store"><span className="guest-label-text">{t.form.store}</span><select id="group-f-store" value={f.store} onChange={e=>setF({...f,store:e.target.value})}>{['MOUNTAIN_BASE','ONSEN_BASE'].map(s=><option key={s} value={s}>{storeName(ja,s)}</option>)}</select></label></div>
      {fld('startDate',t.form.start,{type:'date'})}{fld('endDate',t.form.end,{type:'date'})}
      <div className="guest-field"><label htmlFor="group-f-startAt"><span className="guest-label-text">{t.form.startAt}</span><select id="group-f-startAt" value={f.startAt} onChange={e=>setF({...f,startAt:e.target.value})}><option value="08:30">08:30</option><option value="13:00">13:00</option></select></label></div>
      <div className="guest-field"><label htmlFor="group-f-returnBy"><span className="guest-label-text">{t.form.returnBy}</span><select id="group-f-returnBy" value={f.returnBy} onChange={e=>setF({...f,returnBy:e.target.value})}><option value="12:00">12:00</option><option value="17:00">17:00</option></select></label></div>
      {fld('people',t.form.people,{type:'number',min:1,max:100,inputMode:'numeric'})}
     </div>
     <p className="guest-hint">{t.form.peopleNote} {t.form.note}</p>
    </fieldset>
    <div className="guest-actions"><button type="submit" className="guest-primary" disabled={busy==='start'} aria-busy={busy==='start'}>{busy==='start'?t.form.going:t.form.go}</button></div>
   </form></>;
 }

 const v=view!;
 const resume=resumeKey&&<section className="group-resume" aria-label={t.resume.title}><h2>{t.resume.title}</h2><p>{t.resume.body}</p><input readOnly aria-label={t.resume.title} value={typeof location!=='undefined'?location.origin+'/'+locale+'/group/'+token+'/'+v.group.id+'#k='+resumeKey:''} onFocus={e=>e.currentTarget.select()}/><button type="button" onClick={()=>void copy()}>{copied?t.resume.copied:t.resume.copy}</button></section>;
 const colLabel=(k:string)=>k;void colLabel;
 const summary=<dl className="guest-facts guest-facts--compact"><div><dt>{t.done.number}</dt><dd>{v.group.groupNumber}</dd></div><div><dt>{t.done.period}</dt><dd>{v.group.period.startDate}{v.group.period.endDate!==v.group.period.startDate?' – '+v.group.period.endDate:''}</dd></div><div><dt>{t.done.store}</dt><dd>{storeName(ja,v.group.pickupStore)}</dd></div></dl>;

 return <>{head}{stepper}{errorBox}{resume}{summary}
  {step===2&&<section aria-labelledby="group-rows-h">
   <h2 id="group-rows-h">{t.rows.heading}</h2><p className="guest-intro">{t.rows.intro}</p>
   <div className="group-toolbar" role="group" aria-label={t.rows.dl}>
    <button type="button" onClick={()=>void template('empty')} disabled={busy==='dl'}>{t.rows.dlEmpty}</button>
    <button type="button" onClick={()=>void template('example')} disabled={busy==='dl'}>{t.rows.dlExample}</button>
    <button type="button" onClick={()=>void template('legend')} disabled={busy==='dl'}>{t.rows.dlLegend}</button>
    <button type="button" onClick={exportCurrent} disabled={!rows.length}>{t.rows.dlCurrent}</button>
   </div>
   <fieldset className="group-import"><legend>{t.rows.import}</legend>
    <div role="radiogroup" aria-label={t.rows.import}>
     <label className="guest-choice"><input type="radio" name="group-mode" checked={mode==='REPLACE'} onChange={()=>{setMode('REPLACE');setImp(null);}}/><span>{t.rows.modeReplace}</span></label>
     <label className="guest-choice"><input type="radio" name="group-mode" checked={mode==='ADD'} onChange={()=>{setMode('ADD');setImp(null);}}/><span>{t.rows.modeAdd}</span></label>
    </div>
    <div className="guest-field"><label htmlFor="group-file"><span className="guest-label-text">{t.rows.file}</span><input id="group-file" type="file" accept=".csv,text/csv" onChange={e=>{void onFile(e.target.files?.[0]);e.currentTarget.value='';}}/></label></div>
    {imp&&imp.errors.length>0&&<div role="alert" className="group-alert"><strong>{t.rows.parseFail}</strong> {t.rows.errCount(imp.errors.length+imp.more)}<ul>{imp.errors.map((e,i)=><li key={i}>{e}</li>)}</ul>{imp.more>0&&<p>{t.rows.more(imp.more)}</p>}</div>}
    {imp?.diff&&<div className="group-diff" aria-label={t.rows.diffTitle}><h3>{t.rows.diffTitle}</h3>
     <ul className="group-diff-counts">{(['ADD','CHANGE','UNCHANGED','REMOVE','CONFLICT'] as const).map(k=><li key={k}>{t.rows.diff[k]} {imp.diff!.counts[k]}</li>)}</ul>
     {imp.diff.counts.CONFLICT>0&&<p role="alert" className="group-alert">{t.rows.conflictNote}</p>}
     {imp.diff.counts.REMOVE>0&&<p className="guest-status">{t.rows.removeNote}</p>}
     <ul className="group-diff-list">{imp.diff.entries.slice(0,30).map((e,i)=><li key={i}>{t.rows.diff[e.kind]}{'line' in e?' · '+(ja?e.line+'行目':'line '+e.line):''}{e.kind==='CHANGE'?' · '+e.changes.map(c=>c.field).join(', '):''}</li>)}</ul>
     <div className="guest-actions"><button type="button" onClick={()=>setImp(null)}>{t.rows.cancel}</button><button type="button" className="guest-primary" onClick={applyImport} disabled={imp.diff.counts.CONFLICT>0}>{t.rows.apply}</button></div>
    </div>}
   </fieldset>
   <div className="group-list-head">
    <p role="status" className="group-count">{t.rows.count(rows.length)}{planned?` / ${planned}`:''}</p>
    <div role="group" aria-label={t.rows.filterLabel} className="group-filter">
     {(['all','check','short'] as const).map(k=><button key={k} type="button" aria-pressed={filter===k} onClick={()=>setFilter(k)}>{t.rows.filter[k]}{k==='check'?` (${checkCount})`:k==='short'?` (${shortCount})`:''}</button>)}
    </div>
   </div>
   {selected.size>0&&<fieldset className="group-bulk"><legend>{t.rows.bulk} · {t.rows.selected(selected.size)}</legend>
    <div className="guest-grid">
     <div className="guest-field"><label htmlFor="bulk-field"><span className="guest-label-text">{t.rows.bulkField}</span><select id="bulk-field" value={bulk.field} onChange={e=>setBulk({field:e.target.value as typeof bulk.field,value:e.target.value==='tier'?'REGULAR':e.target.value==='wearAddon'?'YES':''})}><option value="tier">{t.rows.fields.tier}</option><option value="wearAddon">{t.rows.fields.wear}</option><option value="jacketSize">{t.rows.fields.jacket}</option><option value="pantsSize">{t.rows.fields.pants}</option></select></label></div>
     <div className="guest-field"><label htmlFor="bulk-value"><span className="guest-label-text">{t.rows.bulkValue}</span><select id="bulk-value" value={bulk.value} onChange={e=>setBulk({...bulk,value:e.target.value})}>
      {bulk.field==='tier'&&<><option value="REGULAR">{t.rows.tiers.REGULAR}</option></>}
      {bulk.field==='wearAddon'&&<><option value="YES">YES</option><option value="NO">NO</option></>}
      {bulk.field==='jacketSize'&&<><option value="">{t.rows.fields.choose}</option>{csv!.jacketSizes.map(s=><option key={s} value={s}>{s}</option>)}</>}
      {bulk.field==='pantsSize'&&<><option value="">{t.rows.fields.choose}</option>{csv!.pantsSizes.map(s=><option key={s} value={s}>{s}</option>)}</>}
     </select></label></div>
    </div>
    <button type="button" onClick={applyBulk}>{t.rows.bulkApply}</button>
   </fieldset>}
   {!rows.length&&<p className="guest-hint">{t.rows.empty}</p>}
   <ul className="group-rows">{shown.map(r=><RowCard key={r.uid} r={r} n={rowIndex.get(r.uid)!+1} t={t} csv={csv!} errors={check.byRow.get(rowIndex.get(r.uid)!)} advice={adviceByUid.get(r.uid)} selected={selected.has(r.uid)} confirming={confirmDel===r.uid}
     onEdit={edit} onSelect={(uid,on)=>setSelected(s=>{const n=new Set(s);if(on)n.add(uid);else n.delete(uid);return n;})} onCopy={copyRow} onDelete={uid=>confirmDel===uid?delRow(uid):setConfirmDel(uid)} onCancelDelete={()=>setConfirmDel(null)}/>)}</ul>
   <div className="guest-actions">
    <button type="button" onClick={addRow} disabled={rows.length>=GROUP_CSV_MAX_ROWS}>{t.rows.add}</button>
    <button type="button" className="guest-primary" onClick={()=>void runAdvice()} disabled={!canAdvise||busy==='advise'} aria-busy={busy==='advise'}>{busy==='advise'?t.advice.running(rows.length):t.rows.next}</button>
   </div>
   {!canAdvise&&rows.length>0&&<p className="guest-hint" role="status">{t.rows.needFix}</p>}
   {busy==='advise'&&<p role="status" className="guest-status">{t.advice.running(rows.length)}</p>}
  </section>}

  {step===3&&adviceRes&&<section aria-labelledby="group-advice-h">
   <h2 id="group-advice-h">{t.advice.heading}</h2><p className="guest-intro">{t.advice.intro}</p>
   {!adviceFresh&&<p role="alert" className="group-alert">{t.advice.stale}</p>}
   <p role="status" className="guest-status">{t.advice.summary(adviceRes.summary)}</p>
   {adviceRes.joint!=='FEASIBLE'&&<p role="alert" className="group-alert">{t.advice.jointShort}</p>}
   <ul className="group-rows">{rows.map((r,i)=>{const a=adviceRes.advice[i];if(!a)return null;const dir=directions[r.uid]??'RECOMMENDED',chosen=a.candidates[dir];const ok=a.state==='READY'||a.state==='EDGE';
    return <li key={r.uid} className="group-advice-row" data-state={a.state}>
     <h3>{r.label||t.rows.person(i+1)} <span className={'guest-flag guest-flag--edge'} data-testid="row-state">{t.rows.status[a.state]}</span></h3>
     {ok?<fieldset className="guest-skier-type"><legend>{t.advice.heading}</legend>
      <div className="guest-candidates" role="radiogroup" aria-label={r.label||t.rows.person(i+1)}>
       {(['SHORTER','RECOMMENDED','LONGER'] as const).map(d=>{const c=a.candidates[d];return c?<label key={d} className={'guest-candidate'+(d==='RECOMMENDED'?' guest-candidate--primary':'')}><input type="radio" name={'dir-'+r.uid} checked={dir===d} onChange={()=>setDirections(x=>({...x,[r.uid]:d}))}/>
        <span className="guest-candidate-label">{t.advice.direction[d]}</span>
        {r.sport==='WEAR'?<span className="guest-candidate-text">{r.jacketSize} / {r.pantsSize}</span>:<span className="guest-candidate-value">{c.sizeLabel??c.lengthCm+' '+t.advice.cm}</span>}
        {c.fit&&c.fit.kind!=='NORMAL'&&<span className="guest-flag guest-flag--edge">{fitBadge(c.fit.kind,ja)}</span>}</label>:null;})}
      </div>
      {(chosen?.fit&&chosen.fit.kind!=='NORMAL'||a.state==='EDGE')&&<p className="guest-fit-notice">{fitNotice(ja)}</p>}
     </fieldset>:<div>
      {a.state==='MANUAL_FIT_REQUIRED'&&<p className="guest-fit-notice guest-fit-notice--manual">{fitManualNotice(ja)}</p>}
      {a.state!=='MANUAL_FIT_REQUIRED'&&<p role="alert" className="group-alert">{t.rows.status[a.state]}</p>}
      <button type="button" onClick={()=>{setFilter(a.state==='SHORT'?'short':'check');setStep(2);}}>{t.advice.fixRow}</button></div>}
    </li>;})}</ul>
   <div className="guest-actions">
    <button type="button" onClick={()=>setStep(2)}>{t.rows.heading}</button>
    <button type="button" onClick={()=>void runAdvice()} disabled={busy==='advise'}>{t.advice.again}</button>
    <button type="button" className="guest-primary" onClick={()=>void saveAndQuote()} disabled={!allResolved||busy==='save'} aria-busy={busy==='save'}>{busy==='save'?t.advice.saving:t.advice.next}</button>
   </div>
   {!allResolved&&<p className="guest-hint" role="status">{t.advice.blocked}</p>}
  </section>}

  {step===4&&v.estimate&&<section aria-labelledby="group-quote-h">
   <h2 id="group-quote-h">{t.quote.heading}</h2><p className="guest-intro">{t.quote.intro}</p>
   {!quoteFresh&&<p role="alert" className="group-alert">{t.quote.stale} <button type="button" onClick={()=>void requote()} disabled={busy==='requote'}>{t.quote.requote}</button></p>}
   <dl className="guest-price"><dt>{t.quote.subtotal}</dt><dd>{yen(ja,v.estimate.subtotalJpy)}</dd><dt>{t.quote.bundle}</dt><dd className="guest-price-discount">−{yen(ja,v.estimate.bundleDiscountJpy)}</dd><dt>{t.quote.member}</dt><dd className="guest-price-discount">−{yen(ja,v.estimate.memberDiscountJpy)}</dd><dt>{t.quote.group}</dt><dd className="guest-price-discount">−{yen(ja,v.estimate.groupDiscountJpy)}</dd><dt>{t.quote.total}</dt><dd data-testid="quote-total">{yen(ja,v.estimate.totalJpy)}</dd></dl>
   <p className="guest-note">{t.quote.days}: {t.quote.days_(days(v.group.period))} · {t.rows.count(v.group.memberCount)}</p>
   <h3>{t.quote.perPerson}</h3>
   <ul className="group-quote-lines">{v.estimate.lines.map(l=><li key={l.memberId}><h4>{v.rows[l.ordinal-1]?.label||t.rows.person(l.ordinal)}</h4><table><caption className="group-sr">{v.rows[l.ordinal-1]?.label||t.rows.person(l.ordinal)}</caption><thead><tr><th scope="col">{t.quote.item}</th><th scope="col">{t.quote.days}</th><th scope="col">{t.quote.price}</th></tr></thead><tbody>{l.items.map((it,i)=><tr key={i}><td>{(PRODUCT[it.productKey]??[it.productKey,it.productKey])[ja?0:1]}</td><td>{t.quote.days_(days(v.group.period))}</td><td>{yen(ja,it.lineJpy)}{it.bundleDiscountJpy?` (−${yen(ja,it.bundleDiscountJpy)})`:''}</td></tr>)}</tbody><tfoot><tr><th scope="row" colSpan={2}>{t.quote.total}</th><td>{yen(ja,l.finalJpy)}</td></tr></tfoot></table></li>)}</ul>
   <p className="guest-status">{t.quote.stock}: {adviceRes&&adviceFresh&&adviceRes.joint==='FEASIBLE'&&adviceRes.summary.short===0?t.quote.stockOk:t.quote.stockUnknown}</p>
   <p className="guest-status" data-testid="pay-on-site">{t.quote.pay}</p>
   <p className="guest-hint">{legal?.terms?<a href={legal.terms} target="_blank" rel="noopener noreferrer">{t.quote.terms}</a>:t.quote.terms} · {legal?.cancellation?<a href={legal.cancellation} target="_blank" rel="noopener noreferrer">{t.quote.cancel}</a>:t.quote.cancel}</p>
   <label className="guest-choice"><input type="checkbox" checked={agree||v.consented} disabled={v.consented} onChange={e=>setAgree(e.target.checked)}/><span>{t.quote.agree}</span></label>
   {anyEdge&&<label className="guest-choice"><input type="checkbox" checked={fitOk||v.consented} disabled={v.consented} onChange={e=>setFitOk(e.target.checked)}/><span>{t.quote.fit}</span></label>}
   {failed&&<div role="alert" className="group-alert"><strong>{t.quote.failTitle}</strong><p>{t.quote.failBody}</p></div>}
   <div className="guest-actions">
    <button type="button" onClick={backToRows}>{t.quote.back}</button>
    <button type="button" className="guest-primary" onClick={()=>void submit()} disabled={!quoteFresh||!(agree||v.consented)||(anyEdge&&!(fitOk||v.consented))||busy==='submit'} aria-busy={busy==='submit'}>{busy==='submit'?t.quote.submitting:t.quote.submit}</button>
   </div>
  </section>}

  {step===5&&<section aria-labelledby="group-done-h">
   <h2 id="group-done-h">{t.done.heading}</h2>
   <p role="status" className="guest-status" data-testid="group-status" data-status={v.group.status}>{(t.done.status as Record<string,string>)[v.group.status]??v.group.status}</p>
   <dl className="guest-facts"><div><dt>{t.done.number}</dt><dd data-testid="group-number">{v.group.groupNumber}</dd></div><div><dt>{t.done.period}</dt><dd>{v.group.period.startDate}{v.group.period.endDate!==v.group.period.startDate?' – '+v.group.period.endDate:''}</dd></div><div><dt>{t.done.people}</dt><dd>{t.rows.count(v.group.memberCount)}</dd></div><div><dt>{v.group.status==='CONFIRMED'?t.done.finalQuote:t.done.total}</dt><dd>{yen(ja,v.group.status==='CONFIRMED'?(v.group.confirmedTotalJpy??v.finalQuote?.totalJpy):v.estimate?.totalJpy)}</dd></div></dl>
   <p className="guest-note">{t.done.settle}: {t.done.settleValue}</p>
   {['REVIEW_HELD','CHANGES_REQUESTED'].includes(v.group.status)&&<p className="guest-hint">{t.done.heldNote}</p>}
   {['REVIEW_HELD','CHANGES_REQUESTED','CONFIRMED'].includes(v.group.status)&&<fieldset className="group-request"><legend>{t.done.request}</legend><p>{t.done.requestIntro}</p>
    <div role="radiogroup" aria-label={t.done.request}>
     <label className="guest-choice"><input type="radio" name="req-kind" checked={reqKind==='CHANGE'} onChange={()=>setReqKind('CHANGE')}/><span>{t.done.kindChange}</span></label>
     <label className="guest-choice"><input type="radio" name="req-kind" checked={reqKind==='DECLINE'} onChange={()=>setReqKind('DECLINE')}/><span>{t.done.kindDecline}</span></label>
    </div>
    <div className="guest-field"><label htmlFor="req-body"><span className="guest-label-text">{t.done.body}</span><textarea id="req-body" value={reqBody} maxLength={2000} rows={4} onChange={e=>setReqBody(e.target.value)}/></label></div>
    <button type="button" onClick={()=>void sendRequest()} disabled={!reqBody.trim()||busy==='request'}>{t.done.send}</button>
    {reqSent&&<p role="status" className="guest-status">{t.done.sent}</p>}
    {v.requests.length>0&&<><h3>{t.done.recorded}</h3><ul>{v.requests.map((q,i)=><li key={i}>{t.done.kindName[q.kind]} · {(t.done.statusName as Record<string,string>)[q.status]??q.status}</li>)}</ul></>}
   </fieldset>}
  </section>}
 </>;
}

const RowCard=memo(function RowCard({r,n,t,csv,errors,advice,selected,confirming,onEdit,onSelect,onCopy,onDelete,onCancelDelete}:{r:ERow;n:number;t:GroupCopy;csv:GroupCsvCatalog;errors:string[]|undefined;advice:Advice|undefined;selected:boolean;confirming:boolean;onEdit:(uid:string,p:Partial<ERow>)=>void;onSelect:(uid:string,on:boolean)=>void;onCopy:(uid:string)=>void;onDelete:(uid:string)=>void;onCancelDelete:()=>void}){
 const F=t.rows.fields,items=r.equipment.kind==='ITEMS'?r.equipment.items:undefined,need=r.sport==='WEAR'?{height:false,foot:false,ski:false}:profileFields(r.sport,undefined,items);
 const id=(k:string)=>`row-${r.uid}-${k}`,err=errors&&errors.length>0,desc=err?id('err'):undefined;
 const num=(k:'ageAtStart'|'heightCm'|'weightKg'|'footCm',label:string,step?:string)=><div className="guest-field"><label htmlFor={id(k)}><span className="guest-label-text">{label}</span><input id={id(k)} type="number" inputMode="decimal" step={step??'1'} value={r[k]??''} aria-describedby={desc} aria-invalid={err&&r[k]===null?true:undefined} onChange={e=>onEdit(r.uid,{[k]:e.target.value===''?null:Number(e.target.value)} as Partial<ERow>)}/></label></div>;
 const sel=(k:string,label:string,value:string,opts:[string,string][],on:(v:string)=>void)=><div className="guest-field"><label htmlFor={id(k)}><span className="guest-label-text">{label}</span><select id={id(k)} value={value} aria-describedby={desc} onChange={e=>on(e.target.value)}>{opts.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label></div>;
 const state=advice?.state;
 return <li className="group-row" data-state={state??(err?'INVALID':'')}>
  <fieldset><legend>{r.label||t.rows.person(n)}{state&&state!=='READY'?<span className="guest-flag guest-flag--edge">{t.rows.status[state]}</span>:err?<span className="guest-flag guest-flag--edge">{t.rows.status.INVALID}</span>:null}</legend>
   <label className="group-select"><input type="checkbox" checked={selected} onChange={e=>onSelect(r.uid,e.target.checked)} aria-label={t.rows.selected(1)+' '+(r.label||t.rows.person(n))}/><span>{t.rows.person(n)}</span></label>
   <div className="guest-grid">
    <div className="guest-field"><label htmlFor={id('label')}><span className="guest-label-text">{F.label}</span><input id={id('label')} value={r.label??''} maxLength={40} onChange={e=>onEdit(r.uid,{label:e.target.value===''?null:e.target.value})}/></label></div>
    {sel('sport',F.sport,r.sport,[['SKI',t.rows.sports.SKI],['SNOWBOARD',t.rows.sports.SNOWBOARD],['WEAR',t.rows.sports.WEAR]],v=>onEdit(r.uid,{sport:v as ERow['sport'],equipment:v==='WEAR'?{kind:'NONE'}:{kind:'SET'}}))}
    {r.sport!=='WEAR'&&sel('mode',F.mode,r.equipment.kind==='ITEMS'?'ITEMS':'SET',[['SET',F.set],['ITEMS',F.items]],v=>onEdit(r.uid,{equipment:v==='SET'?{kind:'SET'}:{kind:'ITEMS',items:SPORT_ITEMS[r.sport]!.slice(0,2) as never}}))}
    {r.sport!=='WEAR'&&r.equipment.kind==='ITEMS'&&<fieldset className="guest-skier-type group-items"><legend>{F.equipment}</legend>{SPORT_ITEMS[r.sport]!.map(it=>{const cur=r.equipment.kind==='ITEMS'?r.equipment.items:[];return <label key={it} className="guest-choice"><input type="checkbox" checked={cur.includes(it as never)} onChange={e=>onEdit(r.uid,{equipment:{kind:'ITEMS',items:(e.target.checked?[...cur,it]:cur.filter(x=>x!==it)) as never}})}/><span>{(t.rows.items as Record<string,string>)[it]}</span></label>;})}</fieldset>}
    {r.sport!=='WEAR'&&sel('tier',F.tier,r.tier,[['REGULAR',t.rows.tiers.REGULAR],['PREMIUM',t.rows.tiers.PREMIUM]],v=>onEdit(r.uid,{tier:v as ERow['tier']}))}
    {r.tier==='PREMIUM'&&r.sport!=='WEAR'&&sel('model',F.model,r.premiumModelCode??'',[['',F.choose],...csv.premiumModels.filter(m=>m.sport===r.sport).map(m=>[m.code,m.label??m.code] as [string,string])],v=>onEdit(r.uid,{premiumModelCode:v||null}))}
    {num('ageAtStart',F.age)}
    {need.height&&num('heightCm',F.height)}{need.ski&&num('weightKg',F.weight)}{need.foot&&num('footCm',F.foot,'0.1')}
    {need.ski&&sel('skier',F.skier,r.skierType??'',[['',F.choose],...SKIERS.map(s=>[s,t.rows.skiers[s]] as [string,string])],v=>onEdit(r.uid,{skierType:(v||null) as ERow['skierType']}))}
    {r.sport!=='WEAR'&&<div className="guest-field"><label className="guest-choice" htmlFor={id('wear')}><input id={id('wear')} type="checkbox" checked={r.wearAddon} onChange={e=>onEdit(r.uid,{wearAddon:e.target.checked})}/><span>{F.wear}</span></label></div>}
    {(r.sport==='WEAR'||r.wearAddon)&&<>
     {r.sport==='WEAR'&&sel('wearSport',F.wearSport,r.wearSport??'SKI',[['SKI',t.rows.sports.SKI],['SNOWBOARD',t.rows.sports.SNOWBOARD]],v=>onEdit(r.uid,{wearSport:v as ERow['wearSport']}))}
     {sel('jacket',F.jacket,r.jacketSize??'',[['',F.choose],...csv.jacketSizes.map(s=>[s,s] as [string,string])],v=>onEdit(r.uid,{jacketSize:v||null}))}
     {sel('pants',F.pants,r.pantsSize??'',[['',F.choose],...csv.pantsSizes.map(s=>[s,s] as [string,string])],v=>onEdit(r.uid,{pantsSize:v||null}))}</>}
   </div>
   {err&&<ul id={id('err')} className="guest-field-error" role="alert">{errors!.map(e=><li key={e}>{e}</li>)}</ul>}
   <div className="group-row-actions"><button type="button" onClick={()=>onCopy(r.uid)}>{t.rows.copy}</button>
    <button type="button" onClick={()=>onDelete(r.uid)}>{confirming?t.rows.delConfirm:t.rows.del}</button>{confirming&&<button type="button" onClick={onCancelDelete}>{t.rows.cancel}</button>}</div>
  </fieldset></li>;
});
