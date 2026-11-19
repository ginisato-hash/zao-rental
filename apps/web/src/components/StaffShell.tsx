'use client';
import {useState,type ReactNode} from 'react';
import Link from 'next/link';
import {usePathname,useRouter} from 'next/navigation';
import {st,STAFF_LOCALE_COOKIE,type StaffKey,type StaffLocale} from './staff-i18n';
import {StaffInboxBell} from './StaffInboxBell';
import './staff-shell.css';

export type ShellAccess={bookingView:boolean;bookingCreate:boolean;inventoryView:boolean;operationsView:boolean;manageStaff:boolean;transferView:boolean;quoteView:boolean;holdView:boolean};
type Item={key:StaffKey;href:string;match:RegExp;show:(a:ShellAccess)=>boolean};
// Booqable sidebar order. Only destinations that exist as working screens are listed; nothing is a placeholder.
const TOP:Item[]=[
 {key:'dashboard',href:'/staff',match:/^\/staff(\/today)?\/?$/,show:()=>true},
];
const WORK:Item[]=[
 {key:'orders',href:'/staff/orders',match:/^\/staff\/(orders|rentals|amendments|holds|quotes|recommendations|notifications)/,show:a=>a.bookingView},
 {key:'inventory',href:'/staff/ledger',match:/^\/(staff\/(ledger|wear|transfers)|admin\/(inventory|assets))/,show:a=>a.inventoryView},
];
const MORE:Item[]=[
 {key:'bulk',href:'/admin/ops',match:/^\/admin\/(ops|notifications|prices|launch)/,show:a=>a.operationsView},
];
const BOTTOM:Item[]=[
 {key:'settings',href:'/staff/settings',match:/^\/staff\/(settings|users|password|content)/,show:()=>true},
];

/** Shared staff/admin shell: Booqable information order, Apple visual language. The language switch keeps the current
 * URL (with its query: store, date, filters) and only re-renders text; form state inside the page is preserved because the
 * page is refreshed in place rather than navigated away. */
export function StaffShell({locale,stamp,stores,access,name,children}:{locale:StaffLocale;stamp:string;stores:string[];access:ShellAccess;name:string;children:ReactNode}){
 const t=(k:StaffKey)=>st(locale,k),path=usePathname()??'/staff',router=useRouter(),[open,setOpen]=useState(false);
 function setLocale(next:StaffLocale){
  if(next===locale)return;
  document.cookie=`${STAFF_LOCALE_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol===`https:`?`; Secure`:``}`;
  document.documentElement.lang=next;router.refresh();
 }
 const link=(i:Item)=>i.show(access)&&<li key={i.key}><Link href={i.href} aria-current={i.match.test(path)?'page':undefined}>{t(i.key)}</Link></li>;
 return <div className="sx" data-open={open||undefined}>
  <aside className="sx-side" aria-label={t('menu')} onClick={e=>{if((e.target as Element).closest('a'))setOpen(false);}}>
   <div className="sx-brand"><Link href="/staff">SALOMON <span>Rental Station Zao</span></Link></div>
   {access.bookingCreate&&<Link className="sx-btn sx-btn--primary sx-new" href="/staff/quotes">{t('newOrder')}</Link>}
   <nav>{[TOP,WORK,MORE].filter(g=>g.some(i=>i.show(access))).map((g,n)=><ul key={n}>{g.map(link)}</ul>)}</nav>
   <nav className="sx-side-bottom"><ul>{BOTTOM.map(link)}<li><Link href="/staff/logout">{t('signOut')}</Link></li></ul>
    <p className="sx-user">{name}</p></nav>
  </aside>
  <div className="sx-main">
   <header className="sx-top">
    <button type="button" className="sx-iconbtn sx-menu" aria-expanded={open} onClick={()=>setOpen(o=>!o)} aria-label={t('menu')}>
     <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>
    <div className="sx-top-r">
     <div className="sx-seg" role="group" aria-label={t('language')}>
      <button type="button" aria-pressed={locale==='ja'} onClick={()=>setLocale('ja')} lang="ja">日本語</button>
      <button type="button" aria-pressed={locale==='en'} onClick={()=>setLocale('en')} lang="en">English</button>
     </div>
     {access.bookingView&&stores.length>0&&<StaffInboxBell locale={locale} stamp={stamp} stores={stores}/>}
    </div>
   </header>
   <div className="sx-content">{children}</div>
  </div>
  <button type="button" className="sx-scrim" aria-hidden="true" tabIndex={-1} onClick={()=>setOpen(false)}/>
 </div>;
}
