'use client';
import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import type {Campaign} from './brand';

// Palace top (measured 2026-10-10, docs/execution/p85-ui/ELEMENTS.md): the selection advances every 5000 ms; wheel rows sit at
// ±27.5 / ±48.9 / ±65 / ±76.6 px from the active row with opacity .4705 / .1715 / .0370 / 0. The row-shift easing and duration were
// not measured, so rows change position without an invented animation; only the measured .25 s image cross-fade is used.
const INTERVAL_MS=5000;
const ROWS=[{d:-4,y:-76.6,o:0},{d:-3,y:-65,o:.037},{d:-2,y:-48.9,o:.1715},{d:-1,y:-27.5,o:.4705},{d:0,y:0,o:1},{d:1,y:27.5,o:.4705},{d:2,y:48.9,o:.1715},{d:3,y:65,o:.037},{d:4,y:76.6,o:0}];

export function HomeCampaigns({items,heading,ja}:{items:Campaign[];heading:string;ja:boolean}){
 const [active,setActive]=useState(0),[paused,setPaused]=useState(false),[reduced,setReduced]=useState(false);
 const root=useRef<HTMLElement>(null);
 useEffect(()=>{const q=matchMedia('(prefers-reduced-motion: reduce)'),f=()=>setReduced(q.matches);f();q.addEventListener('change',f);return ()=>q.removeEventListener('change',f);},[]);
 useEffect(()=>{if(paused||reduced||items.length<2)return;const t=setInterval(()=>{if(!document.hidden)setActive(a=>(a+1)%items.length);},INTERVAL_MS);return ()=>clearInterval(t);},[paused,reduced,items.length]);
 const at=(d:number)=>items[((active+d)%items.length+items.length)%items.length]!,current=items[active]!;
 const step=(d:number)=>setActive(a=>((a+d)%items.length+items.length)%items.length);
 return <section ref={root} className="pc-hero" aria-roledescription={ja?'カルーセル':'carousel'} aria-label={heading}
  onMouseEnter={()=>setPaused(true)} onMouseLeave={()=>setPaused(false)} onFocus={()=>setPaused(true)} onBlur={e=>{if(!root.current?.contains(e.relatedTarget as Node))setPaused(false);}}>
  <div className="pc-frame"><div className="pc-clip">
   {items.map((c,i)=><Link key={c.key} href={c.href} className={'pc-slide'+(i===active?' is-active':'')} aria-hidden={i!==active} tabIndex={-1}>
    <picture><source media="(min-width: 768px)" srcSet={c.desktop}/><img src={c.mobile} alt={i===active?c.alt:''} style={{['--pos-d' as string]:c.positionDesktop,['--pos-m' as string]:c.positionMobile}} loading={i===0?'eager':'lazy'} decoding="async"/></picture>
   </Link>)}
  </div></div>
  <ul className="pc-wheel" aria-label={ja?'企画':'Campaigns'}>
   {ROWS.map(r=>{const c=at(r.d);return <li key={r.d} style={{transform:`translateY(${r.y}px)`,opacity:r.o,color:c.titleColor}} aria-hidden={r.d!==0}>
    <button type="button" tabIndex={r.d===0?0:-1} onClick={()=>step(r.d)} aria-current={r.d===0?'true':undefined}>{c.title}</button></li>;})}
  </ul>
  <p className="pc-title-m" style={{color:current.titleColorMobile}} aria-live={paused?'polite':'off'}>{current.title}</p>
  <div className="pc-step"><button type="button" onClick={()=>step(-1)} aria-label={ja?'前の企画':'Previous campaign'}>&lt;</button><button type="button" onClick={()=>step(1)} aria-label={ja?'次の企画':'Next campaign'}>&gt;</button></div>
  <Link className="pc-view" href={current.href} style={{['--btn-bg' as string]:current.accent,['--btn-fg' as string]:current.accentText}}>{current.label}</Link>
 </section>;
}
