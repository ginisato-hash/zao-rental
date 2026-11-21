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
  const found=root.current;if(!found)return;const el:HTMLElement=found;
  const $=<T extends Element>(q:string)=>el.querySelector(q) as T,$$=(q:string)=>[...el.querySelectorAll<HTMLElement>(q)];
  const mv=$<HTMLDivElement>('.mv'),cvs=$<HTMLDivElement>('.cv'),pins=$<HTMLDivElement>('.pins'),P=Object.fromEntries(M.points.map(p=>[p.id,p])),els:Record<string,HTMLElement>={};
  const RM=matchMedia('(prefers-reduced-motion: reduce)');let view:View=initial;
  pins.replaceChildren();
  M.points.forEach(p=>{const st=p.id==='mountain'||p.id==='central',e=document.createElement(st?'button':'span');
   e.className='pin '+(st?'stp':'lm');
   if(st){(e as HTMLButtonElement).type='button';e.innerHTML=`<span class="sq">${p.n}</span><span class="nm">${p.en}</span>`;e.setAttribute('aria-label',p.en);e.onclick=()=>show(p.id as View,false,true);}
   else{const i=document.createElement('i'),b=document.createElement('b');b.textContent=ja?p.ja:p.en;e.append(i,b);}
   pins.appendChild(e);els[p.id]=e;});
  // Camera (k = scale, tx/ty = translation) is separate from the selected station: tabs and station pins move the
  // camera and select; wheel, drag, pinch, keys and the +/− buttons only move the camera (Owner 2026-11-19).
  const W=2976,H=2164;let cam={k:1,tx:0,ty:0},moved=false;
  const zin=$<HTMLButtonElement>('.zm-in'),zout=$<HTMLButtonElement>('.zm-out'),zall=$<HTMLButtonElement>('.zm-all');
  const kMin=()=>Math.max(mv.clientWidth/W,mv.clientHeight/H),kMax=()=>Math.max(kMin()*6,1.6);
  function clamp(c:{k:number;tx:number;ty:number}){const w=mv.clientWidth,h=mv.clientHeight,k=Math.min(kMax(),Math.max(kMin(),c.k));
   return {k,tx:Math.min(0,Math.max(w-W*k,c.tx)),ty:Math.min(0,Math.max(h-H*k,c.ty))};}
  function fit(x0:number,y0:number,x1:number,y1:number){const w=mv.clientWidth,h=mv.clientHeight,k=Math.min(w/(x1-x0),h/(y1-y0));
   return clamp({k,tx:w/2-(x0+x1)/2*k,ty:h/2-(y0+y1)/2*k});}
  function apply(c:{k:number;tx:number;ty:number},instant?:boolean){
   cam=clamp(c);const t=cam,w=mv.clientWidth,cfg=M.views[view];
   el.classList.toggle('drag',!!instant);
   cvs.style.transform=`translate(${t.tx}px,${t.ty}px) scale(${t.k})`;
   for(const [id,e] of Object.entries(els)){
    const p=P[id]!,x=p.x*t.k+t.tx,y=p.y*t.k+t.ty,st=id==='mountain'||id==='central';
    e.classList.toggle('hide',!st&&!cfg.show.includes(id));
    if(st){e.classList.toggle('on',id===view);e.classList.toggle('off',view!=='all'&&id!==view);}
    const a=st?22:5;e.classList.remove('l');
    if((cfg.flip??[]).includes(id)||x-a+e.offsetWidth>w-12)e.classList.add('l');
    const dx=e.classList.contains('l')?-(e.offsetWidth-2*a):0;
    e.style.transform=`translate(${x+dx}px,${y}px)`;}
   const m=[100,200,500,1000,2000].find(m=>m*t.k>=64)??2000;$<HTMLElement>('.sct').textContent=m+' M';$<HTMLElement>('.scb').style.width=m*t.k+'px';
   zin.disabled=t.k>=kMax()-1e-6;zout.disabled=t.k<=kMin()+1e-6;
  }
  function zoomAt(f:number,cx:number,cy:number,instant?:boolean){moved=true;const k=Math.min(kMax(),Math.max(kMin(),cam.k*f)),r=k/cam.k;
   apply({k,tx:cx-(cx-cam.tx)*r,ty:cy-(cy-cam.ty)*r},instant);}
  function show(v:string,quiet?:boolean,jump?:boolean){
   view=isView(v)?v:'all';moved=false;const wide=mv.clientWidth>=640,r=wide?520:360,cfg=M.views[view];
   apply(view==='all'?fit(...cfg.box!):fit(P[view]!.x-r,P[view]!.y-r*1.05,P[view]!.x+r,P[view]!.y+r*1.05));
   $$('.tabs button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.v===view)));
   $$('.panel .card').forEach(c=>c.hidden=c.dataset.v!==view);
   if(!quiet)history.replaceState(history.state,'',view===initial?location.pathname+location.search:'#'+view);
   if(jump&&!wide&&mv.getBoundingClientRect().top<0)mv.scrollIntoView({block:'center',behavior:RM.matches?'auto':'smooth'});
  }
  // Pointer input. Mouse/pen: drag pans. Touch: one finger keeps scrolling the page (touch-action:pan-y), two fingers
  // pan and pinch-zoom, so the map never traps phone scrolling.
  const pts=new Map<number,{x:number;y:number;type:string}>();let last:{x:number;y:number;d:number}|null=null;
  const local=(e:{clientX:number;clientY:number})=>{const b=mv.getBoundingClientRect();return {x:e.clientX-b.left,y:e.clientY-b.top};};
  const gesture=()=>{const a=[...pts.values()];if(!a.length)return null;if(a[0]!.type==='touch'&&a.length<2)return null;
   const x=a.reduce((s,p)=>s+p.x,0)/a.length,y=a.reduce((s,p)=>s+p.y,0)/a.length,d=a.length>1?Math.hypot(a[0]!.x-a[1]!.x,a[0]!.y-a[1]!.y):0;return {x,y,d};};
  const onDown=(e:PointerEvent)=>{if((e.target as Element).closest('button,a'))return;if(e.pointerType==='mouse'&&e.button!==0)return;
   pts.set(e.pointerId,{...local(e),type:e.pointerType});if(e.pointerType!=='touch'||pts.size>1)mv.setPointerCapture(e.pointerId);last=gesture();};
  const onMove=(e:PointerEvent)=>{if(!pts.has(e.pointerId))return;pts.set(e.pointerId,{...local(e),type:e.pointerType});const g=gesture();
   if(g&&last){e.preventDefault();moved=true;const f=last.d&&g.d?g.d/last.d:1,k=Math.min(kMax(),Math.max(kMin(),cam.k*f)),r=k/cam.k;
    apply({k,tx:g.x-(last.x-cam.tx)*r,ty:g.y-(last.y-cam.ty)*r},true);}
   last=g;};
  const onUp=(e:PointerEvent)=>{pts.delete(e.pointerId);last=gesture();if(!pts.size)el.classList.remove('drag');};
  const onWheel=(e:WheelEvent)=>{if(!e.ctrlKey&&Math.abs(e.deltaX)>Math.abs(e.deltaY))return;e.preventDefault();const p=local(e);
   zoomAt(Math.exp(-Math.max(-60,Math.min(60,e.deltaMode?e.deltaY*16:e.deltaY))/300),p.x,p.y,true);};
  const onKey=(e:KeyboardEvent)=>{if(e.target!==mv)return;const s=80,cx=mv.clientWidth/2,cy=mv.clientHeight/2;let done=true;
   switch(e.key){case 'ArrowLeft':apply({...cam,tx:cam.tx+s});break;case 'ArrowRight':apply({...cam,tx:cam.tx-s});break;
    case 'ArrowUp':apply({...cam,ty:cam.ty+s});break;case 'ArrowDown':apply({...cam,ty:cam.ty-s});break;
    case '+':case '=':zoomAt(1.4,cx,cy);break;case '-':case '_':zoomAt(1/1.4,cx,cy);break;case '0':show('all');break;default:done=false;}
   if(done){e.preventDefault();if(e.key!=='0')moved=true;}};
  const onZin=()=>zoomAt(1.4,mv.clientWidth/2,mv.clientHeight/2),onZout=()=>zoomAt(1/1.4,mv.clientWidth/2,mv.clientHeight/2),onZall=()=>show('all');
  mv.addEventListener('pointerdown',onDown);mv.addEventListener('pointermove',onMove);mv.addEventListener('pointerup',onUp);mv.addEventListener('pointercancel',onUp);
  // MAP-01: pressing on the terrain image must pan the map, never start the browser's native image drag (which cancels
  // the pointer stream after the first move, so a desktop drag only moved a few pixels).
  const noNativeDrag=(e:DragEvent)=>e.preventDefault();mv.addEventListener('dragstart',noNativeDrag);
  mv.addEventListener('wheel',onWheel,{passive:false});mv.addEventListener('keydown',onKey);
  zin.addEventListener('click',onZin);zout.addEventListener('click',onZout);zall.addEventListener('click',onZall);
  const tabs=$$('.tabs button'),gos=$$('[data-go]'),onTab=(e:Event)=>show((e.currentTarget as HTMLElement).dataset.v!),onGo=(e:Event)=>show((e.currentTarget as HTMLElement).dataset.go!,false,true);
  tabs.forEach(b=>b.addEventListener('click',onTab));gos.forEach(b=>b.addEventListener('click',onGo));
  const init=()=>show(location.hash.slice(1)||initial,true),resize=()=>moved?apply(cam,true):show(view,true),hash=()=>show(location.hash.slice(1)||initial,true);
  let live=true;void (document.fonts?document.fonts.ready:Promise.resolve()).then(()=>{if(live)init();});
  addEventListener('resize',resize);const ro=new ResizeObserver(()=>{if(live)resize();});ro.observe(mv);addEventListener('hashchange',hash);
  return ()=>{live=false;tabs.forEach(b=>b.removeEventListener('click',onTab));gos.forEach(b=>b.removeEventListener('click',onGo));removeEventListener('resize',resize);ro.disconnect();removeEventListener('hashchange',hash);
   mv.removeEventListener('pointerdown',onDown);mv.removeEventListener('pointermove',onMove);mv.removeEventListener('pointerup',onUp);mv.removeEventListener('pointercancel',onUp);
   mv.removeEventListener('dragstart',noNativeDrag);mv.removeEventListener('wheel',onWheel);mv.removeEventListener('keydown',onKey);zin.removeEventListener('click',onZin);zout.removeEventListener('click',onZout);zall.removeEventListener('click',onZall);};
 },[ja,initial]);
 const card=(id:'mountain'|'central')=>{const s=S[id],d=dir(id),[a,b]=s.name.split(' ');
  return <article className="card" data-v={id} hidden={initial!==id} key={id}><h2 className="nm2">{a}<br/>{b}</h2><p className="ln">{s.tag}<br/>{s.hours}</p><p className="ad">{ja?s.ja:s.en}</p>
   <p className="maps"><a className="tl" href={d.g} rel="noopener" target="_blank">Google Maps ↗</a><a className="tl" href={d.a} rel="noopener" target="_blank">Apple Maps ↗</a></p></article>;};
 return <section className="stmap" id="map" ref={root} aria-label="MAP">
  <div className="st-wrap">
   <div>
    <div className="tabs" role="group" aria-label={ja?'地図の表示':'Map view'}>{(['all','mountain','central'] as const).map(v=><button key={v} type="button" data-v={v} aria-pressed={v===initial}>{v==='all'?(ja?'全体':'All'):v==='mountain'?'Mountain':'Central'}</button>)}</div>
    <div className="mv" tabIndex={0} role="application" aria-roledescription={ja?'地図':'map'} aria-label={ja?'地図。矢印キーで移動、+ と − で拡大縮小、0 で全体表示':'Map. Arrow keys move, + and − zoom, 0 shows both stations'}>
     <div className="cv">
      {/* eslint-disable-next-line @next/next/no-img-element -- 2976×2164 LP terrain artwork transformed as one layer, exactly as on the LP */}
      <img src={terrain.src} alt="" width={2976} height={2164} draggable={false}/>
     </div>
     <div className="pins"/>
     <div className="zm" role="group" aria-label={ja?'拡大縮小':'Zoom'}><button type="button" className="zm-in" aria-label={ja?'拡大':'Zoom in'}>+</button><button type="button" className="zm-out" aria-label={ja?'縮小':'Zoom out'}>−</button><button type="button" className="zm-all">{ja?'全体表示':'Show all'}</button></div>
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
