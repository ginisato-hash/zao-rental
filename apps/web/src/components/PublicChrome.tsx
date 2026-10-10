'use client';
import Link from 'next/link';
import Image from 'next/image';
import {useEffect,useRef,useState} from 'react';
import {logos,BRAND_NAME,STORE_DISPLAY,type Campaign} from './brand';

type Locale='ja'|'en';
type LinkItem={href:string;label:string};
export type LegalLink=LinkItem;
const L=(ja:boolean,j:string,e:string)=>ja?j:e;

function nav(locale:Locale){const ja=locale==='ja',r='/'+locale;return {
 pill:[{href:r+'/rental',label:L(ja,'レンタル','RENTAL')},{href:r+'/pickup-return',label:L(ja,'店舗','STORES')},{href:r+'/faq',label:L(ja,'よくある質問','FAQ')}] as LinkItem[],
 book:{href:r+'/book',label:L(ja,'予約する','BOOK')} as LinkItem,
 categories:[{href:r+'/rental/ski',label:'SKI'},{href:r+'/rental/snowboard',label:'SNOWBOARD'},{href:r+'/rental/wear',label:'WEAR'},{href:r+'/rental/premium',label:'PREMIUM'},{href:r+'/rental/kids-family',label:L(ja,'キッズ・ファミリー','KIDS & FAMILY')},{href:r+'/prices',label:L(ja,'料金','PRICES')}] as LinkItem[],
 small:[{href:r+'/pickup-return',label:L(ja,'受取・返却','PICKUP & RETURN')},{href:r+'/faq',label:L(ja,'よくある質問','FAQ')},{href:r+'/reservation',label:L(ja,'予約の確認','MY BOOKING')}] as LinkItem[],
};}

/** Palace-measured header: fixed, 20px from the top, centred black pill 60px high, fully rounded. Desktop shows the links; below 768px
 * the pill holds the logo and MENU, which opens a 10px-inset panel (rgba(0,0,0,.25), blur 50px, radius 30px). */
export function PublicHeader({locale,alternate,campaigns=[]}:{locale:Locale;alternate:string;campaigns?:Campaign[]}){
 const ja=locale==='ja',n=nav(locale),[open,setOpen]=useState(false),toggle=useRef<HTMLButtonElement>(null),panel=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(!open)return;const prev=document.body.style.overflow;document.body.style.overflow='hidden';panel.current?.querySelector<HTMLElement>('a,button')?.focus();
  const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){setOpen(false);toggle.current?.focus();}};document.addEventListener('keydown',key);
  return ()=>{document.body.style.overflow=prev;document.removeEventListener('keydown',key);};},[open]);
 const close=()=>setOpen(false);
 return <>
  <header className="pc-header">
   <div className="pc-pill">
    <Link className="pc-logo" href={'/'+locale} aria-label={BRAND_NAME+(ja?' ホーム':' home')} onClick={close}>
     <Image className="pc-logo-d" src={logos.horizontal} alt="" unoptimized priority/>
     <Image className="pc-logo-m" src={logos.wordmark} alt="" unoptimized priority/>
    </Link>
    <nav className="pc-links" aria-label={L(ja,'メインナビゲーション','Main navigation')}>{n.pill.map(l=><Link key={l.href} href={l.href}>{l.label}</Link>)}<Link href={n.book.href}>{n.book.label}</Link></nav>
    <button ref={toggle} type="button" className="pc-menu-btn" aria-expanded={open} aria-controls="pc-menu" aria-label={open?L(ja,'メニューを閉じる','Close menu'):L(ja,'メニューを開く','Open menu')} onClick={()=>setOpen(o=>!o)}>{open?'CLOSE':'MENU'}</button>
   </div>
  </header>
  {open&&<div id="pc-menu" ref={panel} className="pc-menu" role="dialog" aria-modal="true" aria-label={L(ja,'メニュー','Menu')}>
   <ul className="pc-menu-cats">{n.categories.map(l=><li key={l.href}><Link href={l.href} onClick={close}>{l.label}</Link></li>)}</ul>
   <div className="pc-menu-foot">
    <ul className="pc-menu-small">{n.small.map(l=><li key={l.href}><Link href={l.href} onClick={close}>{l.label}</Link></li>)}<li><Link href={alternate} hrefLang={ja?'en':'ja'} onClick={close}>{ja?'ENGLISH':'日本語'}</Link></li></ul>
    <Link className="pc-menu-book" href={n.book.href} onClick={close}>{n.book.label}</Link>
   </div>
   {campaigns.length>0&&<div className="pc-menu-cards">{campaigns.map(c=><Link key={c.key} className="pc-menu-card" href={c.href} onClick={close}><span><b>{c.title}</b><small>{ja?'見る':'VIEW'}</small></span><Image src={c.mobile} alt="" width={80} height={80} unoptimized/></Link>)}</div>}
  </div>}
 </>;
}

/** Palace-measured footer: white, padding 80/0/20, 20px gutters, 6 columns (2 below 768px), 10px bold headings, 16px bold links. */
export function PublicFooter({locale,alternate,legal}:{locale:Locale;alternate:string;legal:LegalLink[]}){
 const ja=locale==='ja',r='/'+locale,n=nav(locale);
 const cols:[string,LinkItem[]][]=[
  [L(ja,'店舗','STORES'),[{href:r+'/stores/mountain-base',label:STORE_DISPLAY.MOUNTAIN_BASE},{href:r+'/stores/onsen-base',label:STORE_DISPLAY.ONSEN_BASE},{href:r+'/pickup-return',label:L(ja,'受取・返却','PICKUP & RETURN')}]],
  [L(ja,'レンタル','RENTAL'),[{href:r+'/rental',label:L(ja,'プラン比較','COMPARE PLANS')},...n.categories]],
  [L(ja,'ご予約','BOOKING'),[n.book,{href:r+'/reservation',label:L(ja,'予約の確認','MY BOOKING')},{href:r+'/faq',label:L(ja,'よくある質問','FAQ')}]],
  [L(ja,'規約・表記','LEGAL'),legal],
  [L(ja,'言語','LANGUAGE'),[{href:alternate,label:ja?'ENGLISH':'日本語'}]],
 ];
 return <footer className="pc-footer"><div className="pc-footer-in">
  <div className="pc-footer-grid">{cols.filter(([,l])=>l.length>0).map(([h,l])=><div key={h}><h6>{h}</h6><ul>{l.map(x=><li key={x.href+x.label}><Link href={x.href} hrefLang={x.href===alternate?(ja?'en':'ja'):undefined}>{x.label}</Link></li>)}</ul></div>)}
  <Image className="pc-footer-logo" src={logos.stacked} alt={BRAND_NAME} unoptimized/></div>
 </div><p className="pc-copy">© 株式会社Yuge {new Date().getFullYear()} · <Link href="/staff/login">{L(ja,'スタッフ入口','STAFF')}</Link></p></footer>;
}
