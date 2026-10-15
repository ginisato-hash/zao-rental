'use client';
import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import {STORE_DISPLAY} from './brand';
import {menuImages,logo} from './brand/media';

type Locale='ja'|'en';
type LinkItem={href:string;label:string};
export type LegalLink=LinkItem;
type Guard=(e:React.MouseEvent)=>void;
const L=(ja:boolean,j:string,e:string)=>ja?j:e;
export const SITE_NAME='SALOMON STATION ZAO';
const path=(locale:Locale,p:string)=>'/'+locale+(p?'/'+p:'');

function nav(locale:Locale){const ja=locale==='ja',r='/'+locale;return {
 /** The four giant menu words (LP: one word per destination). */
 main:[{href:r+'/rental',label:'RENTAL',img:'rental'},{href:r+'/prices',label:'PRICES',img:'prices'},{href:r+'/pickup-return',label:'STORES',img:'stores'},{href:r+'/faq',label:'FAQ',img:'faq'}] as (LinkItem&{img:string})[],
 book:{href:r+'/book',label:'BOOK'} as LinkItem,
 /** Secondary row (R67): categories + MY BOOKING. Children are an age category of each person, never a FAMILY product. */
 categories:[{href:r+'/rental/ski',label:'SKI'},{href:r+'/rental/snowboard',label:'SNOWBOARD'},{href:r+'/rental/premium',label:'PREMIUM'},{href:r+'/rental/wear',label:'WEAR'},{href:r+'/reservation',label:'MY BOOKING'}] as LinkItem[],
 small:[{href:r+'/stores/mountain-base',label:STORE_DISPLAY.MOUNTAIN_BASE},{href:r+'/stores/onsen-base',label:STORE_DISPLAY.ONSEN_BASE},{href:r+'/pickup-return',label:L(ja,'受取・返却','PICKUP & RETURN')}] as LinkItem[],
};}

/** LP chrome: quiet edge type with difference blending (legible on white, black and photos), no pill, no logo plate.
 * Left: the site name home link. Right: JP/EN, BOOK, MENU. The menu is a modal full black field (LP .mnu) with the
 * accessibility contract kept from the previous header: focus starts inside, Tab/Shift+Tab cycle inside, the rest of
 * the page is inert, Escape/CLOSE close and return focus to MENU, the scroll lock is always restored. */
/** The official logo is always the LP raster asset (never type); `context` is the plain-text page marker. */
function Brand({locale,context,onClick}:{locale:Locale;context:'RENTAL'|'BOOKING';onClick:Guard}){
 // eslint-disable-next-line @next/next/no-img-element -- fixed-size official logo raster; next/image adds nothing here
 return <span className="st-hd-left"><Link className="st-hd-home" href={'/'+locale} aria-label={SITE_NAME+(locale==='ja'?' ホーム':' home')} onClick={onClick}><img src={logo.src} width={logo.width} height={logo.height} alt={SITE_NAME}/></Link><span className="st-hd-ctx" aria-label={context==='BOOKING'?L(locale==='ja','予約','Booking'):L(locale==='ja','レンタル','Rental')}>{context}</span></span>;
}
// Owner (2026-10-15): the context marker reads BOOKING on every page of this booking site (the LP is the brand site).
export function PublicHeader({locale,page,guard,context='BOOKING'}:{locale:Locale;page:string;homeHeading?:string|undefined;guard?:Guard|undefined;context?:'RENTAL'|'BOOKING'}){
 const ja=locale==='ja',n=nav(locale),[open,setOpen]=useState(false),[img,setImg]=useState(''),toggle=useRef<HTMLButtonElement>(null),panel=useRef<HTMLDivElement>(null);
 const returnFocus=useRef(false);
 useEffect(()=>{if(!open){if(returnFocus.current){returnFocus.current=false;toggle.current?.focus();}return;}
  const prev=document.body.style.overflow;document.body.style.overflow='hidden';
  const shell=panel.current?.closest('.public-shell'),inerted:HTMLElement[]=[];
  shell?.querySelectorAll<HTMLElement>(':scope > *').forEach(el=>{if(el!==panel.current&&!el.inert){el.inert=true;inerted.push(el);}});
  const focusables=()=>[...(panel.current?.querySelectorAll<HTMLElement>('a[href],button:not([disabled])')??[])];
  focusables()[0]?.focus();
  const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();returnFocus.current=true;setOpen(false);return;}
   if(e.key!=='Tab')return;const list=focusables();if(!list.length)return;const i=list.indexOf(document.activeElement as HTMLElement);
   if(e.shiftKey&&i<=0){e.preventDefault();list[list.length-1]!.focus();}else if(!e.shiftKey&&(i===-1||i===list.length-1)){e.preventDefault();list[0]!.focus();}};
  document.addEventListener('keydown',key);
  return ()=>{document.body.style.overflow=prev;document.removeEventListener('keydown',key);inerted.forEach(el=>{el.inert=false;});};},[open]);
 const go=(e:React.MouseEvent)=>{guard?.(e);if(!e.defaultPrevented)setOpen(false);};
 const here=path(locale,page),lang=(l:Locale)=><Link href={path(l,page)} hrefLang={l} lang={l} aria-current={l===locale?'true':undefined} onClick={go}>{l==='ja'?'JP':'EN'}</Link>;
 const home=<Brand locale={locale} context={context} onClick={go}/>;
 return <>
  <a className="st-skip" href="#main">{L(ja,'本文へ','Skip to content')}</a>
  <header className="st-hd">
   {home}
   <div className="st-hd-r">
    <span className="st-hd-lang">{lang('ja')}{lang('en')}</span>
    <Link className="st-hd-book" href={n.book.href} aria-current={here===n.book.href?'page':undefined} onClick={go}>{n.book.label}</Link>
    <button ref={toggle} type="button" className="st-hd-menu" aria-expanded={open} aria-controls="st-menu" aria-label={L(ja,'メニューを開く','Open menu')} onClick={()=>setOpen(true)}>MENU</button>
   </div>
  </header>
  {open&&<div id="st-menu" ref={panel} className="st-mnu" role="dialog" aria-modal="true" aria-label={L(ja,'メニュー','Menu')}>
   <div className="st-mnu-top">
    <Brand locale={locale} context={context} onClick={go}/>
    <div className="st-hd-r"><span className="st-hd-lang">{lang('ja')}{lang('en')}</span>
     <button type="button" className="st-hd-menu" aria-label={L(ja,'メニューを閉じる','Close menu')} onClick={()=>{returnFocus.current=true;setOpen(false);}}>CLOSE</button></div>
   </div>
   <div className="st-mnu-body">
    <ul className="st-mnu-main" onPointerLeave={()=>setImg('')}>{n.main.map(l=><li key={l.href}><Link className="st-mnu-mi" href={l.href} aria-current={here===l.href?'page':undefined} onClick={go} onPointerEnter={()=>setImg(l.img)} onFocus={()=>setImg(l.img)}>{l.label}</Link></li>)}</ul>
    <div className="st-mnu-side">
     <ul className="st-mnu-cats" aria-label={L(ja,'用品カテゴリ','Equipment')}>{n.categories.map(l=><li key={l.href}><Link href={l.href} onClick={go}>{l.label}</Link></li>)}</ul>
     <ul className="st-mnu-small">{n.small.map(l=><li key={l.href}><Link href={l.href} onClick={go}>{l.label}</Link></li>)}</ul>
     <Link className="st-cta st-cta--w" href={n.book.href} onClick={go}>BOOK RENTAL<span className="ar" aria-hidden="true">↗</span></Link>
    </div>
    <figure className={'st-mnu-img'+(img?' on':'')} aria-hidden="true">{Object.entries(menuImages).map(([k,src])=><picture key={k}><img className={img===k?'on':undefined} src={src} alt="" loading="lazy" decoding="async"/></picture>)}</figure>
   </div>
  </div>}
 </>;
}

/** LP footer: one quiet line, preceded by the minimum link index a transactional site needs (legal, booking, stores, staff). */
export function PublicFooter({locale,page,legal}:{locale:Locale;page:string;legal:LegalLink[]}){
 const ja=locale==='ja',r='/'+locale,n=nav(locale),other:Locale=ja?'en':'ja';
 const cols:[string,LinkItem[]][]=[
  [L(ja,'レンタル','RENTAL'),[{href:r+'/rental',label:L(ja,'ラインナップ','LINEUP')},...n.categories,{href:r+'/prices',label:L(ja,'料金','PRICES')}]],
  [L(ja,'店舗','STORES'),[{href:r+'/stores/mountain-base',label:STORE_DISPLAY.MOUNTAIN_BASE},{href:r+'/stores/onsen-base',label:STORE_DISPLAY.ONSEN_BASE},{href:r+'/pickup-return',label:L(ja,'受取・返却','PICKUP & RETURN')}]],
  [L(ja,'ご予約','BOOKING'),[n.book,{href:r+'/reservation',label:L(ja,'予約の確認','MY BOOKING')},{href:r+'/faq',label:L(ja,'よくある質問','FAQ')}]],
  [L(ja,'規約・表記','LEGAL'),legal],
 ];
 return <footer className="st-ft">
  <nav className="st-ft-grid" aria-label={L(ja,'フッター','Footer')}>{cols.filter(([,l])=>l.length>0).map(([h,l])=><div key={h}><p className="st-lbl">{h}</p><ul>{l.map(x=><li key={x.href+x.label}><Link href={x.href}>{x.label}</Link></li>)}</ul></div>)}
   <div><p className="st-lbl">{L(ja,'言語','LANGUAGE')}</p><ul><li><Link href={path(other,page)} hrefLang={other}>{ja?'ENGLISH':'日本語'}</Link></li><li><Link href="/staff/login">{L(ja,'スタッフ入口','STAFF')}</Link></li></ul></div></nav>
  <p className="st-ft-line" lang="en">An official ski &amp; snowboard rental shop in collaboration between Amer Sports Japan, Inc. and Yuge Inc. · © Yuge Inc. {new Date().getFullYear()} · Photography includes imagery provided by Salomon.</p>
 </footer>;
}

/** LP .fin: black band, giant two-line headline, white CTA, then a full-bleed official campaign photograph. */
export function PublicFinal({locale,photo}:{locale:Locale;photo:React.ReactNode}){
 return <section className="st-fin" aria-labelledby="st-fin-h"><h2 id="st-fin-h" className="st-rv">Book your<br/>Zao winter.</h2>
  <div className="st-fin-acts"><Link className="st-cta st-cta--w" href={'/'+locale+'/book'}>BOOK RENTAL<span className="ar" aria-hidden="true">↗</span></Link></div>
  <div className="st-fin-ph">{photo}</div></section>;
}

/** Arms the LP scroll reveal once mounted: content is SSR-visible until then (see globals.css .st-armed). */
export function StationReveal(){
 useEffect(()=>{const root=document.documentElement;if(!('IntersectionObserver' in window))return;
  const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target);}}),{rootMargin:'0px 0px -8% 0px'});
  document.querySelectorAll('.st-rv:not(.in)').forEach(el=>{const r=el.getBoundingClientRect();if(r.top<innerHeight)el.classList.add('in');else io.observe(el);});
  // Mobile dock: the primary CTA is docked whenever the in-page one is out of view (above or below), never over it.
  const anchor=document.querySelector('.st-desk-acts'),dock=document.querySelector('.st-dock');
  const place=()=>{if(!anchor||!dock)return;const r=anchor.getBoundingClientRect();dock.classList.toggle('on',r.bottom<0||r.top>innerHeight);};
  place();addEventListener('scroll',place,{passive:true});addEventListener('resize',place);
  root.classList.add('st-armed');return ()=>{io.disconnect();removeEventListener('scroll',place);removeEventListener('resize',place);root.classList.remove('st-armed');};},[]);
 return null;
}
