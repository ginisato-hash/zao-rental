import Link from 'next/link';
import {DevelopmentNotice} from './ProductionCopy';
import {canonicalPath,publicPages,pageSchema,safeJsonLd,type Locale} from '../../../../packages/core/src/content/public-pages';
import {publicationApproved} from '../../../../packages/auth/src/publication-authority';
import {approvedLegalDocs,legalDocument,legalPath,legalPublicationComplete} from '../../../../packages/core/src/content/public-legal';
import {PublicHeader,PublicFooter,PublicFinal,StationReveal} from './PublicChrome';
import {S_PATH,S_VIEWBOX} from './brand/salomon-s-path';
import {PriceExplorer} from './PriceExplorer';
import {priceGrid,dayPrice} from './price-rows';
import {products,photos,type Shot} from './brand/media';
import {STORE_DISPLAY} from './brand';
import './public.css';

export function legalLinks(locale:Locale){return approvedLegalDocs(locale).map(d=>({href:canonicalPath(locale,legalPath(d)),label:legalDocument(locale,d)!.title}));}

/** Official Salomon photograph, cropped by CSS (object-fit), never captioned as Zao or as stock. */
export function Photo({shot,locale,eager=false,sizes='100vw'}:{shot:{desktop:string;mobile:string;alt:{ja:string;en:string}};locale:Locale;eager?:boolean;sizes?:string}){
 return <picture><source media="(min-width: 768px)" srcSet={shot.desktop}/><img src={shot.mobile} alt={shot.alt[locale]} sizes={sizes} loading={eager?'eager':'lazy'} decoding="async"/></picture>;
}
function Product({shot,locale,eager=false,sizes}:{shot:Shot;locale:Locale;eager?:boolean;sizes:string}){
 return <picture><img src={shot.src} srcSet={shot.srcSet} sizes={sizes} width={shot.width} height={shot.height} alt={shot.alt[locale]} loading={eager?'eager':'lazy'} decoding="async"/></picture>;
}

/** Shared public frame (LP chrome): edge header + full-field menu, page, final BOOK band, one-line footer. */
export function PublicFrame({locale,path,home=false,homeHeading,final=true,children}:{locale:Locale;path:string;home?:boolean;homeHeading?:string;final?:boolean;children:React.ReactNode}){
 return <div className={'public-shell'+(home?' public-shell--home':'')} lang={locale}>
  <PublicHeader locale={locale} page={path} homeHeading={home?homeHeading:undefined}/>
  {children}
  {final&&<PublicFinal locale={locale} photo={<Photo shot={photos.winter} locale={locale}/>}/>}
  <PublicFooter locale={locale} page={path} legal={legalLinks(locale)}/>
  <StationReveal/>
 </div>;
}

/** One display word per page (LP: a page is one giant noun). Decorative: the semantic h1 carries the page heading. */
const WORD:Record<string,string>={rental:'Rental','rental/ski':'Ski','rental/snowboard':'Snowboard','rental/premium':'Premium','rental/wear':'Wear','rental/kids-family':'Family',prices:'Prices','stores/mountain-base':'Mountain','stores/onsen-base':'Central','pickup-return':'Stores',faq:'FAQ'};
/** LP page head: the page is one giant noun, and that noun is the h1 (no sentence headline, no lead copy). */
export function PageHead({word,children}:{word:string;children?:React.ReactNode}){
 return <header className="st-ph"><h1>{word}</h1>{children}</header>;
}
const yen=(n:number)=>'¥'+n.toLocaleString('en-US');
const STORE_PATH={MOUNTAIN_BASE:'stores/mountain-base',ONSEN_BASE:'stores/onsen-base'} as const;
/** Coordinates of each station's building (OSM, same points as the LP map) for directions links only. */
const STORE_GEO={MOUNTAIN_BASE:'38.169695,140.401042',ONSEN_BASE:'38.16334,140.395437'} as const;

export function PublicPage({page,locale,origin,latePickup,models=[]}:{latePickup:string;models?:{slug:string;name:string;season:string}[];page:typeof publicPages[number];locale:Locale;origin:string}){
 const ja=locale==='ja',path=page.path,t=(j:string,e:string)=>ja?j:e,r='/'+locale;
 const preview=!publicationApproved()&&<DevelopmentNotice><p className="st-preview">{t('予約受付前の開発プレビューです。実決済・本番予約は行いません。','Development preview before booking launch. No real payment or production booking.')}</p></DevelopmentNotice>;
 const schema=pageSchema(locale,path,origin).map((s,i)=><script key={i} type="application/ld+json" dangerouslySetInnerHTML={{__html:safeJsonLd(s)}}/>);
 const book=(label=t('日程から選ぶ','Start with dates'))=><Link className="st-cta" href={r+'/book'}>{label}<span className="ar" aria-hidden="true">↗</span></Link>;
 const facts=<ul className="st-facts">{page.bullets.map(b=><li key={b} className="st-rv">{['モデル・シーズン・長さを予約条件として保存','Your model, season and length are saved as the booking promise'].includes(b)?t('選んだモデル・シーズン・長さで予約できます','Book the model, season and length you choose'):['当店で取扱を確認したモデルだけを掲載','Only models verified at our shop are listed'].includes(b)?t('当店で取扱うPremiumモデルから選べます','Choose from our Premium range'):b}</li>)}</ul>;
 const stations=<div className="st-sum">{(['MOUNTAIN_BASE','ONSEN_BASE'] as const).map(s=><Link key={s} className="st-sumrow" href={canonicalPath(locale,STORE_PATH[s])}>{STORE_DISPLAY[s]}<span className="go" aria-hidden="true">→</span></Link>)}</div>;


 if(path===''){
  const hours=(p:string)=>{const b=publicPages.find(x=>x.locale===locale&&x.path===p)?.bullets.map(v=>/^(?:営業時間|Opening hours)\s+(.+)$/.exec(v)?.[1]).find(Boolean);return b??'—';};
  const board:[string,string,string][]=[
   [STORE_DISPLAY.MOUNTAIN_BASE,hours('stores/mountain-base'),r+'/stores/mountain-base'],
   [STORE_DISPLAY.ONSEN_BASE,hours('stores/onsen-base'),r+'/stores/onsen-base'],
   ['Ski set · Regular · 1 day',yen(dayPrice('SKI_SET_ADULT_REGULAR')),r+'/prices'],
   ['Ski set · Premium · 1 day',yen(dayPrice('SKI_SET_ADULT_PREMIUM')),r+'/rental/premium'],
   ['Snowboard set · 1 day',yen(dayPrice('SNOWBOARD_SET_ADULT_REGULAR')),r+'/rental/snowboard'],
   ['Wear · jacket + pants · 1 day',yen(dayPrice('WEAR_SET_ADULT')),r+'/rental/wear'],
  ];
  return <PublicFrame locale={locale} path={path} home homeHeading={page.heading}><main id="main" className="st-home">
  <section className="st-desk" aria-label="SALOMON STATION ZAO RENTAL">
   <div className="st-desk-ph"><Photo shot={photos.winter} locale={locale} eager sizes="(max-width:767px) 100vw, 58vw"/>
    <h1><span>Rental</span><small>SALOMON STATION ZAO</small></h1></div>
   <div className="st-desk-board">
    <p className="st-desk-top"><svg viewBox={'0 0 '+S_VIEWBOX[0]+' '+S_VIEWBOX[1]} aria-hidden="true" focusable="false"><path d={S_PATH} fillRule="evenodd"/></svg><span>Rental desk</span><span>Winter 26/27</span></p>
    <ul className="st-desk-rows">{board.map(([k,v,h])=><li key={k}><Link href={h}><span>{k}</span><b>{v}</b></Link></li>)}</ul>
    <p className="st-desk-tax">{t('税込 · 前日15:00までの事前決済で5%OFF','Tax included · 5% off when paid by 3:00 PM (JST) the day before')}</p>
    <ol className="st-desk-flow" aria-label={t('予約の流れ','How booking works')}>{['Dates','Gear','Size','Pay'].map(x=><li key={x}>{x}</li>)}</ol>
    <div className="st-desk-acts">{book('BOOK RENTAL')}<Link className="st-link" href={r+'/reservation'}>{t('予約の確認','My booking')} →</Link></div>
   </div>
  </section>
  {preview}
  <section className="st-sec" aria-labelledby="home-rental"><h2 id="home-rental" className="st-word st-rv">Lineup</h2>
   <div className="st-lineup">
    <Link className="st-lu" href={r+'/rental'}><span className="st-lu-ph"><Product shot={products.regular} locale={locale} sizes="(max-width:767px) 100vw, 58vw"/></span><span className="st-lu-n">Regular</span><span className="st-lu-s">{t('モデル非指定','Any model')}</span></Link>
    <Link className="st-lu st-rv" href={r+'/rental/premium'}><span className="st-lu-ph"><Product shot={products.premium} locale={locale} sizes="(max-width:767px) 100vw, 42vw"/></span><span className="st-lu-n">Premium</span><span className="st-lu-s">{t('モデル指定','Model promised')}</span></Link>
    <Link className="st-lu st-rv" href={r+'/rental/snowboard'}><span className="st-lu-ph"><Product shot={products.snowboard} locale={locale} sizes="(max-width:767px) 100vw, 42vw"/></span><span className="st-lu-n">Snowboard</span></Link>
    <Link className="st-lu st-rv" href={r+'/rental/wear'}><span className="st-lu-ph"><Photo shot={photos.wear} locale={locale} sizes="(max-width:767px) 100vw, 58vw"/></span><span className="st-lu-n">Wear</span></Link>
   </div>
   <p className="st-note">{t('同等ランクのアイテムをご用意します。画像のアイテムをご用意できるとは限りません。','We provide items of an equivalent grade. The items shown may not always be available.')}</p>
   <p className="st-chips">{[['rental/ski','SKI'],['rental/kids-family',t('キッズ・ファミリー','KIDS & FAMILY')],['prices',t('料金','PRICES')],['pickup-return',t('受取・返却','PICKUP & RETURN')]].map(([p,l])=><Link key={p} className="st-link" href={r+'/'+p}>{l} →</Link>)}</p>
  </section>
  <div className="st-dock"><Link className="st-cta" href={r+'/book'}>BOOK RENTAL<span className="ar" aria-hidden="true">↗</span></Link></div>
  {schema}</main></PublicFrame>;}
 const word=WORD[path]??'Rental';
 let body:React.ReactNode;
 if(path==='rental'){
  const plan=(k:'regular'|'premium')=>{const p=k==='premium',shot=p?products.premium:products.regular;
   return <article className={'st-plan st-plan--'+k+(p?' st-rv':'')}><div className="st-plan-ph"><Product shot={shot} locale={locale} eager={!p} sizes="(max-width:767px) 100vw, 50vw"/></div>
    <h2>{p?'Premium':'Regular'}</h2>
    <p className="st-plan-promise"><span className={'st-tag'+(p?' st-tag--solid':'')}>{p?t('モデル指定','MODEL PROMISED'):t('モデル非指定','ANY MODEL')}</span></p>
    <dl className="st-plan-dl"><div><dt>{t('選び方','How you choose')}</dt><dd>{p?t('当店で取扱うPremiumモデルから、モデル・シーズン・長さを選んで予約できます。','Choose and book a Premium model, season and length from our range.'):t('身長・足サイズ・年齢区分・クラスから選びます。特定モデルは確約しません。','Choose by height, foot size, age category and class. No specific model is promised.')}</dd></div>
     <div><dt>{t('対象','For')}</dt><dd>{p?t('大人（13歳以上）','Adults (13+)'):t('大人・子供','Adults and children')}</dd></div></dl>
    <p className="st-plan-price"><span className="st-lbl">{t('スキーセット 1日','Ski set · 1 day')}</span><b>{yen(dayPrice(p?'SKI_SET_ADULT_PREMIUM':'SKI_SET_ADULT_REGULAR'))}</b></p>
   </article>;};
  body=<><section className="st-compare" aria-label={t('Regular と Premium','Regular and Premium')}>{plan('regular')}{plan('premium')}</section>
   <div className="st-wrap st-acts">{book()}<Link className="st-link" href={r+'/prices'}>{t('すべての料金','All prices')} →</Link></div>
   <section className="st-wrap" aria-label={t('用品カテゴリ','Equipment')}><div className="st-sum">{publicPages.filter(p=>p.locale===locale&&['rental/ski','rental/snowboard','rental/wear','rental/premium','rental/kids-family'].includes(p.path)).map(p=><Link key={p.path} className="st-sumrow" href={canonicalPath(locale,p.path)}><span>{WORD[p.path]}</span><span className="go" aria-hidden="true">→</span></Link>)}</div></section></>;
 }else if(path==='prices'){
  body=<><div className="st-wrap"><PriceExplorer locale={locale} grid={priceGrid()}/></div><section className="st-wrap" aria-label={page.title}>{facts}<div className="st-acts">{book()}</div></section></>;
 }else if(path==='stores/mountain-base'||path==='stores/onsen-base'){
  const s=path==='stores/mountain-base'?'MOUNTAIN_BASE':'ONSEN_BASE',geo=STORE_GEO[s];
  body=<section className="st-wrap st-store" aria-label={page.title}>
   <p className="st-store-name">{STORE_DISPLAY[s].replace(' ','\n')}</p>
   <dl className="st-store-dl">{page.bullets.map(b=>{const m=/^(\S+)\s+(.+)$/.exec(b);return m?<div key={b} className="st-rv"><dt>{m[1]}</dt><dd>{m[2]}</dd></div>:<div key={b}><dd>{b}</dd></div>;})}</dl>
   <p className="st-maps"><a className="st-link" href={'https://www.google.com/maps/dir/?api=1&destination='+geo} rel="noopener" target="_blank">Google Maps ↗</a><a className="st-link" href={'https://maps.apple.com/?daddr='+geo} rel="noopener" target="_blank">Apple Maps ↗</a></p>
   <div className="st-acts">{book()}<Link className="st-link" href={r+'/pickup-return'}>{t('受取・返却の流れ','Pickup & return')} →</Link></div></section>;
 }else{
  const shot=path==='rental/ski'?<Photo shot={photos.ski} locale={locale} eager/>:path==='rental/wear'?<Photo shot={photos.wear} locale={locale} eager/>:path==='rental/snowboard'?<Product shot={products.snowboard} locale={locale} eager sizes="(max-width:767px) 100vw, 50vw"/>:path==='rental/premium'?<Product shot={products.premium} locale={locale} eager sizes="(max-width:767px) 100vw, 50vw"/>:null;
  body=<>
   {path==='pickup-return'&&<section className="st-wrap" aria-label={t('店舗','Stores')}>{stations}</section>}
   <section className={'st-wrap st-split'+(shot?'':' st-split--solo')} aria-label={page.title}>{shot&&<div className={'st-split-ph'+(path==='rental/snowboard'||path==='rental/premium'?' st-split-ph--fog':'')}>{shot}</div>}<div>{facts}
    {['pickup-return','faq'].includes(path)&&<aside className="st-aside st-rv"><h2>{t('複数日予約の後日受取','Late collection for multi-day bookings')}</h2><p>{latePickup}</p>{!legalPublicationComplete(locale)&&<DevelopmentNotice><small>{t('公開文言・利用規約は公開前確認中です。','Public wording and terms remain subject to review.')}</small></DevelopmentNotice>}</aside>}
    {path==='rental/premium'&&<section className="st-models"><h2 className="st-lbl">{t('Premiumモデル','Premium models')}</h2>{models.length?<ul className="st-rows">{models.map(m=><li key={m.slug}><Link href={canonicalPath(locale,'rental/premium/'+m.slug)}><b>{m.name}</b></Link><span className="st-lbl">{m.season}</span></li>)}</ul>:<p>{t('現在ご案内できるモデルはありません。日程と用品を選んでお確かめください。','No models are listed right now. Choose your dates and equipment to check available options.')}</p>}</section>}
    <div className="st-acts">{book()}</div></div></section></>;
 }
 return <PublicFrame locale={locale} path={path}><main id="main" className="st-page">
  <PageHead word={word}/>
  {preview}{body}{schema}</main></PublicFrame>;
}
