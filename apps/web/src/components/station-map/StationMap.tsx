'use client';
/* Port of the LP STORES map (salomonstation-zao.com/lp/stores, lp.js "v1 cartography"): same terrain artwork, points,
 * views, pins, scale and Google/Apple directions. map-data.json holds the LP mapdata verbatim plus the LP station facts. */
import {useEffect,useRef} from 'react';
import terrain from './terrain.svg';
import source from './map-data.json';
import './station-map.css';

type View='all'|'mountain'|'central';
type Point={id:string;x:number;y:number;ja:string;en:string;n?:string};
const M=source.map as {points:Point[];views:Record<View,{box?:[number,number,number,number];show:string[];flip?:string[]}>};
const S=source.stations;
const dir=(id:'mountain'|'central')=>({g:`https://www.google.com/maps/dir/?api=1&destination=${S[id].lat},${S[id].lon}`,a:`https://maps.apple.com/?daddr=${S[id].lat},${S[id].lon}`});
const isView=(v:string):v is View=>v==='all'||v==='mountain'||v==='central';

export function StationMap({locale,initial='all'}:{locale:'ja'|'en';initial?:View}){
 const ja=locale==='ja',root=useRef<HTMLElement>(null);
 useEffect(()=>{
  const el=root.current;if(!el)return;
  const $=<T extends Element>(q:string)=>el.querySelector(q) as T,$$=(q:string)=>[...el.querySelectorAll<HTMLElement>(q)];
  const mv=$<HTMLDivElement>('.mv'),cvs=$<HTMLDivElement>('.cv'),pins=$<HTMLDivElement>('.pins'),P=Object.fromEntries(M.points.map(p=>[p.id,p])),els:Record<string,HTMLElement>={};
  const RM=matchMedia('(prefers-reduced-motion: reduce)');let view:View=initial;
  pins.replaceChildren();
  M.points.forEach(p=>{const st=p.id==='mountain'||p.id==='central',e=document.createElement(st?'button':'span');
   e.className='pin '+(st?'stp':'lm');
   if(st){(e as HTMLButtonElement).type='button';e.innerHTML=`<span class="sq">${p.n}</span><span class="nm">${p.en}</span>`;e.setAttribute('aria-label',p.en);e.onclick=()=>show(p.id as View,false,true);}
   else{const i=document.createElement('i'),b=document.createElement('b');b.textContent=ja?p.ja:p.en;e.append(i,b);}
   pins.appendChild(e);els[p.id]=e;});
  function fit(x0:number,y0:number,x1:number,y1:number){const w=mv.clientWidth,h=mv.clientHeight,k=Math.max(Math.min(w/(x1-x0),h/(y1-y0)),w/2976,h/2164);
   return {w,h,k,tx:Math.min(0,Math.max(w-2976*k,w/2-(x0+x1)/2*k)),ty:Math.min(0,Math.max(h-2164*k,h/2-(y0+y1)/2*k))};}
  function show(v:string,quiet?:boolean,jump?:boolean){
   view=isView(v)?v:'all';const wide=mv.clientWidth>=640,r=wide?520:360,cfg=M.views[view];
   const t=view==='all'?fit(...cfg.box!):fit(P[view]!.x-r,P[view]!.y-r*1.05,P[view]!.x+r,P[view]!.y+r*1.05);
   cvs.style.transform=`translate(${t.tx}px,${t.ty}px) scale(${t.k})`;
   for(const [id,e] of Object.entries(els)){
    const p=P[id]!,x=p.x*t.k+t.tx,y=p.y*t.k+t.ty,st=id==='mountain'||id==='central';
    e.classList.toggle('hide',!st&&!cfg.show.includes(id));
    if(st){e.classList.toggle('on',id===view);e.classList.toggle('off',view!=='all'&&id!==view);}
    const a=st?22:5;e.classList.remove('l');
    if((cfg.flip??[]).includes(id)||x-a+e.offsetWidth>t.w-12)e.classList.add('l');
    const dx=e.classList.contains('l')?-(e.offsetWidth-2*a):0;
    e.style.transform=`translate(${x+dx}px,${y}px)`;}
   const m=[100,200,500,1000].find(m=>m*t.k>=64)??1000;$<HTMLElement>('.sct').textContent=m+' M';$<HTMLElement>('.scb').style.width=m*t.k+'px';
   $$('.tabs button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.v===view)));
   $$('.panel .card').forEach(c=>c.hidden=c.dataset.v!==view);
   if(!quiet)history.replaceState(history.state,'',view===initial?location.pathname+location.search:'#'+view);
   if(jump&&!wide&&mv.getBoundingClientRect().top<0)mv.scrollIntoView({block:'center',behavior:RM.matches?'auto':'smooth'});
  }
  const tabs=$$('.tabs button'),gos=$$('[data-go]'),onTab=(e:Event)=>show((e.currentTarget as HTMLElement).dataset.v!),onGo=(e:Event)=>show((e.currentTarget as HTMLElement).dataset.go!,false,true);
  tabs.forEach(b=>b.addEventListener('click',onTab));gos.forEach(b=>b.addEventListener('click',onGo));
  const init=()=>show(location.hash.slice(1)||initial,true),resize=()=>show(view,true),hash=()=>show(location.hash.slice(1)||initial,true);
  let live=true;void (document.fonts?document.fonts.ready:Promise.resolve()).then(()=>{if(live)init();});
  addEventListener('resize',resize);addEventListener('hashchange',hash);
  return ()=>{live=false;tabs.forEach(b=>b.removeEventListener('click',onTab));gos.forEach(b=>b.removeEventListener('click',onGo));removeEventListener('resize',resize);removeEventListener('hashchange',hash);};
 },[ja,initial]);
 const card=(id:'mountain'|'central')=>{const s=S[id],d=dir(id),[a,b]=s.name.split(' ');
  return <article className="card" data-v={id} hidden={initial!==id} key={id}><h2 className="nm2">{a}<br/>{b}</h2><p className="ln">{s.tag}<br/>{s.hours}</p><p className="ad">{ja?s.ja:s.en}</p>
   <p className="maps"><a className="tl" href={d.g} rel="noopener" target="_blank">Google Maps ↗</a><a className="tl" href={d.a} rel="noopener" target="_blank">Apple Maps ↗</a></p></article>;};
 return <section className="stmap" id="map" ref={root} aria-label="MAP">
  <div className="st-wrap">
   <div>
    <div className="tabs" role="group" aria-label={ja?'地図の表示':'Map view'}>{(['all','mountain','central'] as const).map(v=><button key={v} type="button" data-v={v} aria-pressed={v===initial}>{v==='all'?'All':v==='mountain'?'Mountain':'Central'}</button>)}</div>
    <div className="mv">
     <div className="cv">
      {/* eslint-disable-next-line @next/next/no-img-element -- 2976×2164 LP terrain artwork transformed as one layer, exactly as on the LP */}
      <img src={terrain.src} alt="" width={2976} height={2164}/>
     </div>
     <div className="pins"/>
     <span className="n" aria-hidden="true">N ↑</span><span className="sc" aria-hidden="true"><span className="sct">200 M</span><b className="scb"/></span>
     <ul className="legend" aria-hidden="true"><li><i/>Road</li><li><i className="lf"/>Lift / ropeway</li><li><i className="lr"/>Ski run</li><li><i className="lw"/>River</li><li><i className="lc"/>Contour 10 m</li></ul>
    </div>
   </div>
   <div className="panel">
    <article className="card" data-v="all" hidden={initial!=='all'}><h2 className="nm2">2 Stations</h2>{(['mountain','central'] as const).map(id=><button key={id} className="sumrow" type="button" data-go={id}>{S[id].name}<span className="go" aria-hidden="true">→</span></button>)}</article>
    {card('mountain')}{card('central')}
   </div>
  </div>
  <p className="credit">{ja?source.source.credit.ja:source.source.credit.en}</p>
 </section>;
}
