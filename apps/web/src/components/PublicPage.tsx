import Link from 'next/link';
import {canonicalPath,publicPages,pageSchema,safeJsonLd,type Locale} from '../../../../packages/core/src/content/public-pages';
import {publicationApproved} from '../../../../packages/auth/src/publication-authority';
import {approvedLegalDocs,legalDocument,legalPath,legalPublicationComplete} from '../../../../packages/core/src/content/public-legal';
import {PublicHeader,PublicFooter} from './PublicChrome';
import {HomeCampaigns} from './HomeCampaigns';
import {campaigns} from './brand';
import './public.css';

export function legalLinks(locale:Locale){return approvedLegalDocs(locale).map(d=>({href:canonicalPath(locale,legalPath(d)),label:legalDocument(locale,d)!.title}));}

/** Shared public frame: Palace-measured header pill, page body, white multi-column footer. */
export function PublicFrame({locale,path,home=false,children}:{locale:Locale;path:string;home?:boolean;children:React.ReactNode}){
 const alternate=canonicalPath(locale==='ja'?'en':'ja',path);
 return <div className={'public-shell'+(home?' public-shell--home':'')} lang={locale}><PublicHeader locale={locale} alternate={alternate} campaigns={campaigns(locale)}/>{children}<PublicFooter locale={locale} alternate={alternate} legal={legalLinks(locale)}/></div>;
}

export function PublicPage({page,locale,origin,latePickup,models=[]}:{latePickup:string;models?:{slug:string;name:string;season:string}[];page:typeof publicPages[number];locale:Locale;origin:string}){const ja=locale==='ja',path=page.path,isRentalHub=path==='rental';
 const preview=!publicationApproved()&&<p className="public-preview-note">{ja?'予約受付前の開発プレビューです。実決済・本番予約は行いません。':'Development preview before booking launch. No real payment or production booking.'}</p>;
 const schema=pageSchema(locale,path,origin).map((s,i)=><script key={i} type="application/ld+json" dangerouslySetInnerHTML={{__html:safeJsonLd(s)}}/>);
 if(path==='')return <PublicFrame locale={locale} path={path} home><main className="public-home"><HomeCampaigns items={campaigns(locale)} heading={page.heading} ja={ja}/>{preview}{schema}</main></PublicFrame>;
 // UX4R-01: on the /rental hub, Regular vs Premium must be the first substantive content.
 const compare=<section className="public-compare"><h2>{ja?'Regular と Premium':'Regular and Premium'}</h2><div className="public-compare-grid"><article><h3>Regular</h3><p>{ja?'サイズ・年齢区分・クラスから選びます。モデルの確約はありません。':'Choose by size, age category and class. No specific model is promised.'}</p></article><article><h3>Premium</h3><p>{ja?'モデル・シーズン・長さを選択条件として保存します。':'Your selected model, season and length become the promise.'}</p></article></div></section>;
 const cards=<ul className="public-card-grid">{publicPages.filter(p=>p.locale===locale&&['rental/ski','rental/snowboard','rental/wear','rental/premium'].includes(p.path)).map(p=><li key={p.path}><Link className="public-card" href={canonicalPath(locale,p.path)}><span>{p.path.split('/')[1]?.toUpperCase()}</span><b>{p.heading}</b><small>{p.summary}</small></Link></li>)}</ul>;
 const explore=isRentalHub?<details className="public-explore public-secondary"><summary>{ja?'用品カテゴリから選ぶ':'Browse by equipment category'}</summary>{cards}</details>:<section className="public-explore"><h2>{ja?'用品カテゴリ':'Equipment'}</h2>{cards}</section>;
 return <PublicFrame locale={locale} path={path}><main className="public-main">
  <div className="public-head"><h1>{page.heading}</h1><p className="public-lead">{page.summary}</p><Link className="public-cta" href={'/'+locale+'/book'}>{ja?'日程から選ぶ':'Start with dates'}</Link></div>
  {preview}
  {isRentalHub&&compare}
  <section className="public-detail"><h2>{page.title}</h2><ul>{page.bullets.map(b=><li key={b}>{b}</li>)}</ul>{['pickup-return','faq'].includes(path)&&<aside><h3>{ja?'複数日予約の後日受取':'Late collection for multi-day bookings'}</h3><p>{latePickup}</p>{!legalPublicationComplete(locale)&&<small>{ja?'公開文言・利用規約は公開前確認中です。':'Public wording and terms remain subject to review.'}</small>}</aside>}</section>
  {explore}
  {path==='rental/premium'&&<section><h2>{ja?'確認済みモデル':'Verified models'}</h2>{models.length?models.map(m=><p key={m.slug}><Link href={canonicalPath(locale,'rental/premium/'+m.slug)}>{m.name} · {m.season}</Link></p>):<p>{ja?'資料・写真・当店取扱の確認が済んだモデルから掲載します。':'Models appear after source, photo rights and shop inventory verification.'}</p>}</section>}
  <nav className="public-links" aria-label={ja?'ご利用ガイド':'Rental guides'}>{publicPages.filter(p=>p.locale===locale&&p.path&&!['rental/ski','rental/snowboard','rental/wear','rental/premium'].includes(p.path)).map(p=><Link key={p.path} href={canonicalPath(locale,p.path)}>{p.title}</Link>)}</nav>
  {schema}</main></PublicFrame>;}
