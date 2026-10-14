'use client';
import {useRef,useState} from 'react';
import {PRICE_ROWS,PRICE_DAY_INDEX,type PriceSport,type PriceGrid} from './price-rows';

/** LP rates explorer: SPORT / AGE / PLAN / DAYS drive one giant answer plus the item rows for that selection.
 * Display only — every cell comes from the booking system's own price tables (see price-rows.ts); no arithmetic here. */
export function PriceExplorer({locale,grid}:{locale:'ja'|'en';grid:PriceGrid}){
 const ja=locale==='ja',[st,setSt]=useState<{sport:PriceSport;age:'adult'|'kids';plan:'regular'|'premium';di:number}>({sport:'ski',age:'adult',plan:'regular',di:1}),num=useRef<HTMLParagraphElement>(null);
 const yen=(n:number)=>'¥'+n.toLocaleString('en-US');
 const dur=(i:number)=>i?(ja?i+'日':i+(i>1?' DAYS':' DAY')):(ja?'半日':'HALF DAY');
 const rowsOf=(sport:PriceSport)=>PRICE_ROWS[sport].rows;
 const premiumAllowed=(s=st)=>s.age==='adult'&&rowsOf(s.sport).some(r=>r.plan==='premium');
 const plan=premiumAllowed()?st.plan:'regular';
 const rows=rowsOf(st.sport).filter(r=>r.plan===plan&&r[st.age]),hero=rows[0]!;
 const set=(patch:Partial<typeof st>)=>{setSt(s=>({...s,...patch}));const v=num.current;if(v&&!matchMedia('(prefers-reduced-motion: reduce)').matches){v.classList.remove('st-flip');void v.offsetWidth;v.classList.add('st-flip');}};
 const seg=(k:'sport'|'age'|'plan',label:string,opts:[string,string,string?][],cols:number)=><div><p className="st-lbl">{label}</p><div className={'st-seg st-seg--'+cols} role="group" aria-label={label}>
  {opts.map(([v,t,s])=><button key={v} type="button" aria-pressed={(k==='plan'?plan:st[k])===v} disabled={k==='plan'&&v==='premium'&&!premiumAllowed()} onClick={()=>set({[k]:v} as Partial<typeof st>)}>{t}{s&&<small>{s}</small>}</button>)}</div></div>;
 return <section className="st-rx" aria-label={ja?'料金':'Prices'}>
  <div className="st-rx-ctl">
   {seg('sport','Sport',[['ski','SKI'],['snowboard','SNOWBOARD'],['wear','WEAR']],3)}
   {seg('age','Age',[['adult','ADULT','13+'],['kids','KIDS','≤12']],2)}
   {seg('plan','Plan',[['regular','REGULAR'],['premium','PREMIUM']],2)}
   <div><p className="st-lbl">Days</p><div className="st-days" role="group" aria-label={ja?'日数':'Days'}>{PRICE_DAY_INDEX.map((_,i)=><button key={i} type="button" aria-pressed={st.di===i} aria-label={dur(i)} onClick={()=>set({di:i})}>{i||(ja?'半日':'HALF')}</button>)}</div></div>
   <div className="st-rx-big" aria-live="polite"><p ref={num} className="st-num">{yen(grid[hero[st.age]!]![st.di]!)}</p>
    <p className="st-rx-w">{[PRICE_ROWS[st.sport].en,ja?hero.ja:hero.en,plan.toUpperCase(),st.age.toUpperCase()].join(' · ')} — {dur(st.di)}</p></div>
   <p className="st-lbl st-rx-tax">{ja?'税込':'TAX INCLUDED'}<br/>{ja?'前日15:00までの事前決済でさらに5%OFF':'EXTRA 5% OFF WHEN PAID BY 3:00 PM (JST) THE DAY BEFORE'}</p>
  </div>
  <ul className="st-rows st-rx-rows">{rows.map(r=><li key={r[st.age]}><div><b>{ja?r.ja:r.en}</b><small>{ja?r.dja:r.den}</small></div><span className="st-rx-p">{yen(grid[r[st.age]!]![st.di]!)}</span></li>)}</ul>
 </section>;
}
