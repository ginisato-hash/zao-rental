import Link from 'next/link';
import {DevelopmentNotice} from './ProductionCopy';
import {canonicalPath,publicPages,pageSchema,safeJsonLd,type Locale} from '../../../../packages/core/src/content/public-pages';
import {publicationApproved} from '../../../../packages/auth/src/publication-authority';
import {approvedLegalDocs,legalDocument,legalPath,legalPublicationComplete} from '../../../../packages/core/src/content/public-legal';
import {PublicHeader,PublicFooter,PublicFinal,StationReveal} from './PublicChrome';
import {PriceExplorer} from './PriceExplorer';
import {priceGrid,dayPrice} from './price-rows';
import {products,photos,type Shot} from './brand/media';
import {STORE_DISPLAY} from './brand';
import {PREMIUM_MODELS} from '../../../../packages/core/src/operations/provisional-catalog-bridge';
/** Owner (2026-10-15): Premium models are not yet confirmed by Salomon; Premium is shown but not bookable until a model is bound. */
const premiumOpen=(family:'SKI'|'SNOWBOARD')=>PREMIUM_MODELS.some(m=>m.family===family);
import './public.css';

export function legalLinks(locale:Locale){return approvedLegalDocs(locale).map(d=>({href:canonicalPath(locale,legalPath(d)),label:legalDocument(locale,d)!.title}));}

/** Official Salomon photograph, cropped by CSS (object-fit), never captioned as Zao or as stock. */
export function Photo({shot,locale,eager=false,sizes='100vw'}:{shot:{desktop:string;mobile:string;alt:{ja:string;en:string}};locale:Locale;eager?:boolean;sizes?:string}){
 return <picture><source media="(min-width: 768px)" srcSet={shot.desktop}/><img src={shot.mobile} alt={shot.alt[locale]} sizes={sizes} loading={eager?'eager':'lazy'} decoding="async"/></picture>;
}
function Product({shot,locale,eager=false,sizes}:{shot:Shot;locale:Locale;eager?:boolean;sizes:string}){
 return <picture><img src={shot.src} srcSet={shot.srcSet} sizes={sizes} width={shot.width} height={shot.height} alt={shot.alt[locale]} loading={eager?'eager':'lazy'} decoding="async"/></picture>;
}

/** Shared public frame (LP chrome): edge header + full-field menu, page, final BOOK band, footer. */
export function PublicFrame({locale,path,final=true,children}:{locale:Locale;path:string;home?:boolean;homeHeading?:string;final?:boolean;children:React.ReactNode}){
 return <div className="public-shell" lang={locale}>
  <PublicHeader locale={locale} page={path}/>
  {children}
  {final&&<PublicFinal locale={locale} photo={<Photo shot={photos.winter} locale={locale}/>}/>}
  <PublicFooter locale={locale} page={path} legal={legalLinks(locale)}/>
  <StationReveal/>
 </div>;
}

/** Page title (Palace grammar): one giant word, optional grey second word; the h1. */
export function PageHead({word,tone,children}:{word:string;tone?:string|undefined;children?:React.ReactNode}){
 return <header className="st-ph"><h1>{word}{tone&&<span className="st-tone"> {tone}</span>}</h1>{children}</header>;
}
const yen=(n:number)=>'¥'+n.toLocaleString('en-US');
const STORE_PATH={MOUNTAIN_BASE:'stores/mountain-base',ONSEN_BASE:'stores/onsen-base'} as const;
/** Coordinates of each station's building (OSM, same points as the LP map) for directions links only. */
const STORE_GEO={MOUNTAIN_BASE:'38.169695,140.401042',ONSEN_BASE:'38.16334,140.395437'} as const;
const maps=(geo:string)=>[['GOOGLE MAPS','https://www.google.com/maps/dir/?api=1&destination='+geo],['APPLE MAPS','https://maps.apple.com/?daddr='+geo]] as const;

type Tile={key:string;name:string;tone:string;fact:string;view:string;image:React.ReactNode;kind:'product'|'photo';soon?:boolean};
function lineup(locale:Locale):Tile[]{
 const ja=locale==='ja',t=(j:string,e:string)=>ja?j:e,r='/'+locale,day=t('1日','1 day');
 const promise=t('モデル指定','Model promised');
 return [
  {key:'ski-regular',name:'SKI',tone:'REGULAR',fact:t('モデル非指定 · セット','Any model · set')+' '+day+' '+yen(dayPrice('SKI_SET_ADULT_REGULAR')),view:r+'/rental/ski',kind:'product',image:<Product shot={products.regular} locale={locale} eager sizes="(max-width:767px) 100vw, 58vw"/>},
  {key:'ski-premium',name:'SKI',tone:'PREMIUM',fact:promise+' · '+t('セット','set')+' '+day+' '+yen(dayPrice('SKI_SET_ADULT_PREMIUM')),view:r+'/rental/premium#ski',kind:'photo',soon:!premiumOpen('SKI'),image:<Product shot={products.premium} locale={locale} sizes="(max-width:767px) 100vw, 42vw"/>},
  {key:'snowboard-regular',name:'SNOWBOARD',tone:'REGULAR',fact:t('モデル非指定 · セット','Any model · set')+' '+day+' '+yen(dayPrice('SNOWBOARD_SET_ADULT_REGULAR')),view:r+'/rental/snowboard',kind:'product',image:<Product shot={products.snowboard} locale={locale} sizes="(max-width:767px) 100vw, 42vw"/>},
  {key:'snowboard-premium',name:'SNOWBOARD',tone:'PREMIUM',fact:promise+' · '+t('セット','set')+' '+day+' '+yen(dayPrice('SNOWBOARD_SET_ADULT_PREMIUM')),view:r+'/rental/premium#snowboard',kind:'photo',soon:!premiumOpen('SNOWBOARD'),image:<Product shot={products.snowboardRide} locale={locale} sizes="(max-width:767px) 100vw, 58vw"/>},
  {key:'wear',name:'WEAR',tone:'JACKET + PANTS',fact:t('上下セット','Jacket + pants')+' · '+day+' '+yen(dayPrice('WEAR_SET_ADULT')),view:r+'/rental/wear',kind:'photo',image:<Photo shot={photos.wear} locale={locale} sizes="100vw"/>},
 ];
}
/** Palace range grid: IMAGE · NAME (two-tone) · 1 FACT · ACTION. Equal-rank, asymmetric. */
function Lineup({locale,only}:{locale:Locale;only?:string[]}){
 const r='/'+locale,tiles=lineup(locale).filter(x=>!only||only.includes(x.key));
 return <div className={'st-grid'+(only?' st-grid--pair':'')}>{tiles.map(x=><article key={x.key} id={x.key} className={'st-tile st-tile--'+x.key+' st-tile--'+x.kind}>
  <Link className="st-tile-ph" href={x.view} tabIndex={-1} aria-hidden="true">{x.image}</Link>
  <div className="st-tile-cap">
   <h2 className="st-tile-n"><Link href={x.view}>{x.name}<span className="st-tone"> {x.tone}</span></Link></h2>
   <p className="st-tile-f">{x.fact}</p>
   <p className="st-tile-a"><Link href={x.view}>VIEW</Link>{x.soon?<span className="st-soon">COMING SOON</span>:<Link href={r+'/book'}>BOOK →</Link>}</p>
  </div>
 </article>)}</div>;
}
const CATS=(locale:Locale)=>{const r='/'+locale;return [['SKI',r+'/rental/ski'],['SNOWBOARD',r+'/rental/snowboard'],['PREMIUM',r+'/rental/premium'],['WEAR',r+'/rental/wear'],['PRICES',r+'/prices'],['STORES',r+'/pickup-return']] as const;};
function CategoryIndex({locale,stacked=false}:{locale:Locale;stacked?:boolean}){
 return <nav className={'st-index'+(stacked?' st-index--stack':'')} aria-label={locale==='ja'?'カテゴリー':'Categories'}><ul>{CATS(locale).map(([l,h])=><li key={l}><Link href={h}>{l}</Link></li>)}</ul></nav>;
}

/** FAQ: every answer restates an implemented rule or approved copy; nothing new is promised here. */
function faq(locale:Locale,latePickup:string):[string,React.ReactNode][]{
 const ja=locale==='ja',t=(j:string,e:string)=>ja?j:e,r='/'+locale;
 return [
  [t('セットには何が含まれますか？','What does a set include?'),t('スキーセットはスキー・ブーツ・ポール、スノーボードセットはボード（ビンディング付き）とブーツです。ウェアは追加できます。','A ski set is skis, boots and poles; a snowboard set is a board (bindings mounted) and boots. Wear can be added.')],
  [t('Premiumとは何ですか？','What is Premium?'),t('モデル・シーズン・長さを指定して予約できるプランです（大人のみ）。ブーツ・ポールは通常の在庫からご用意します。','Book a specific model, season and length (adults only). Boots and poles come from our regular range.')],
  [t('ブーツのサイズはどう選びますか？','How is my boot size chosen?'),<>{t('SALOMON STATION ZAOでは、レンタルブーツは入力いただいた足のサイズ＋1.0cmを目安にご用意します。','SALOMON STATION ZAO prepares rental boots at about 1.0 cm above the foot length you enter.')}<br/>{t('在庫状況により、現地で別サイズへ交換できない場合があります。','Depending on stock, we may not be able to change to another size at the store.')}</>],
  [t('一人で複数の単品を借りられますか？','Can one person rent several individual items?'),t('はい。スキー・ブーツ・ポール、またはボード・ブーツから必要なものを選べます。料金は単品ごとです。','Yes. Choose any of skis, boots and poles — or board and boots. Each item is priced on its own.')],
  [t('半日と複数日は組み合わせられますか？','Can I combine half days with several days?'),t('初日を午後から（13:00）、最終日を昼まで（12:00）にできます。料金は半日と日数の料金表を組み合わせて計算します。','Start the first day at 1:00 PM and/or return at noon on the last day. The price combines the half-day and day prices from the price table.')],
  [t('ウェアだけ借りられますか？','Can I rent wear only?'),t('はい。ジャケットとパンツの上下セットでご用意します。','Yes, as a jacket and pants set.')],
  [t('受取・返却の時間は？','What are the pickup and return times?'),t('営業時間は8:30〜17:00です。開始は朝から（8:30）または午後から（13:00）、返却は昼まで（12:00）または17:00までです。','Open 8:30 AM–5:00 PM. Start from 8:30 AM or 1:00 PM; return by noon or by 5:00 PM.')],
  [t('複数日予約で、開始日より後に受け取れますか？','Can I collect a multi-day booking after the start date?'),latePickup],
  [t('予約QR・別の端末での確認は？','Where is my booking QR? Another device?'),<>{t('予約確認ページでQRを表示できます。別の端末では予約番号と登録メールアドレスで確認コードを受け取り、開き直せます。','Your booking page shows the QR. On another device, enter your booking reference and email to receive a code.')} <Link href={r+'/reservation'}>{t('予約確認','My booking')} →</Link></>],
  [t('キャンセル・返金は？','Cancellation and refunds?'),<>{t('利用開始の48時間前までは全額返金。それ以降の自動返金はありません。','Full refund until 48 hours before the rental starts; no automatic refund after that.')} <Link href={canonicalPath(locale,'legal/cancellation')}>{t('キャンセル・返金規定','Cancellation policy')} →</Link></>],
 ];
}

export function PublicPage({page,locale,origin,latePickup}:{latePickup:string;models?:{slug:string;name:string;season:string}[];page:typeof publicPages[number];locale:Locale;origin:string}){
 const ja=locale==='ja',path=page.path,t=(j:string,e:string)=>ja?j:e,r='/'+locale;
 const preview=!publicationApproved()&&<DevelopmentNotice><p className="st-preview">{t('予約受付前の開発プレビューです。実決済・本番予約は行いません。','Development preview before booking launch. No real payment or production booking.')}</p></DevelopmentNotice>;
 const schema=pageSchema(locale,path,origin).map((s,i)=><script key={i} type="application/ld+json" dangerouslySetInnerHTML={{__html:safeJsonLd(s)}}/>);
 const book=(label='BOOK RENTAL',href=r+'/book')=><Link className="st-cta" href={href}>{label}<span className="ar" aria-hidden="true">↗</span></Link>;

 if(path===''){
  return <PublicFrame locale={locale} path={path}><main id="main" className="st-home">
   <section className="st-fv" aria-labelledby="fv-h">
    <div className="st-fv-txt">
     <h1 id="fv-h" className="st-fv-h">RENTAL</h1>
     <div className="st-fv-acts">{book()}<Link className="st-link" href={r+'/rental'}>VIEW LINEUP →</Link></div>
     <CategoryIndex locale={locale} stacked/>
    </div>
    <div className="st-fv-ph"><Photo shot={photos.winter} locale={locale} eager sizes="(max-width:767px) 100vw, 58vw"/></div>
   </section>
   {preview}
   <section className="st-sec" aria-labelledby="home-lineup"><h2 id="home-lineup" className="st-sec-h">LINEUP<span className="st-tone"> 26/27</span></h2><Lineup locale={locale}/></section>
   <section className="st-sec st-duo" aria-label={t('料金と店舗','Prices and stores')}>
    <Link className="st-duo-i" href={r+'/prices'}><span className="st-duo-n">PRICES</span><span className="st-duo-f">{t('セット 1日','Set · 1 day')} {yen(dayPrice('SKI_SET_ADULT_REGULAR'))}〜 · {t('税込','tax incl.')}</span><span className="st-duo-a" aria-hidden="true">→</span></Link>
    <Link className="st-duo-i" href={r+'/pickup-return'}><span className="st-duo-n">STORES</span><span className="st-duo-f">{STORE_DISPLAY.MOUNTAIN_BASE} · {STORE_DISPLAY.ONSEN_BASE}</span><span className="st-duo-a" aria-hidden="true">→</span></Link>
   </section>
   {schema}</main></PublicFrame>;
 }

 let head:React.ReactNode,body:React.ReactNode=null;
 if(path==='rental'){
  head=<PageHead word="RENTAL" tone="LINEUP"><div className="st-ph-acts">{book()}</div><CategoryIndex locale={locale}/></PageHead>;
  body=<section className="st-sec st-sec--tight" aria-label="LINEUP"><Lineup locale={locale}/></section>;
 }else if(path==='rental/ski'||path==='rental/snowboard'){
  const ski=path==='rental/ski',word=ski?'SKI':'SNOWBOARD';
  const [reg,prem]=ski?['ski-regular','ski-premium']:['snowboard-regular','snowboard-premium'];
  head=<PageHead word={word}><p className="st-ph-l"><a href={'#'+reg}>REGULAR</a> / <a href={'#'+prem}>PREMIUM</a></p><div className="st-ph-acts">{book('BOOK '+word)}</div></PageHead>;
  const rows=(keys:string[])=>keys.map(k=>[k,yen(dayPrice(k))] as const);
  body=<><section className="st-sec st-sec--tight" aria-label={word}><Lineup locale={locale} only={[reg!,prem!]}/></section>
   <section className="st-sec" aria-label={t('1日料金','1-day prices')}><dl className="st-spec">{rows(ski?['SKI_SET_ADULT_REGULAR','SKI_SET_ADULT_PREMIUM','SKI_SET_KIDS_REGULAR']:['SNOWBOARD_SET_ADULT_REGULAR','SNOWBOARD_SET_ADULT_PREMIUM','SNOWBOARD_SET_KIDS_REGULAR']).map(([k,v])=><div key={k}><dt>{(k.includes('KIDS')?t('子供','KIDS'):t('大人','ADULT'))+' · '+(k.endsWith('PREMIUM')?'PREMIUM':'REGULAR')+' · '+t('セット 1日','SET · 1 DAY')}</dt><dd>{v}</dd></div>)}</dl>
    <p className="st-more"><Link className="st-link" href={r+'/prices'}>{t('すべての料金','ALL PRICES')} →</Link></p></section></>;
 }else if(path==='rental/wear'){
  head=<PageHead word="WEAR" tone="JACKET + PANTS"><p className="st-ph-l">{t('上下セット · 1日','Set · 1 day')} {yen(dayPrice('WEAR_SET_ADULT'))} · {t('セット用品と同時で20%OFF','20% off with an equipment set')}</p><div className="st-ph-acts">{book('BOOK WEAR')}</div></PageHead>;
  body=<section className="st-sec st-sec--tight" aria-label="WEAR"><Lineup locale={locale} only={['wear']}/></section>;
 }else if(path==='rental/premium'){
  // R67 (Owner): Premium models are not announced yet, so until a model is bound the page offers Regular booking instead.
  const open=premiumOpen('SKI')||premiumOpen('SNOWBOARD');
  head=<PageHead word="PREMIUM"><p className="st-ph-l">{open?'CHOOSE MODEL / SEASON / LENGTH':'COMING SOON · 2026/27'}</p><div className="st-ph-acts">{open?<a className="st-cta" href="#ski">VIEW SKI MODELS<span className="ar" aria-hidden="true">↓</span></a>:book('BOOK REGULAR')}<a className="st-cta st-cta--line" href={open?'#snowboard':'#ski'}>{open?'VIEW SNOWBOARD MODELS':'VIEW PREMIUM'}<span className="ar" aria-hidden="true">↓</span></a></div></PageHead>;
  // R67 (Owner): no model names in the public Premium display; the model/season/length is chosen in the booking flow.
  const group=(family:'SKI'|'SNOWBOARD',shot:Shot)=><section id={family==='SKI'?'ski':'snowboard'} className="st-sec st-pm" aria-labelledby={'pm-'+family}>
   <div className="st-pm-ph"><Product shot={shot} locale={locale} sizes="(max-width:767px) 100vw, 42vw"/></div>
   <div className="st-pm-list"><h2 id={'pm-'+family} className="st-sec-h">{family}<span className="st-tone"> PREMIUM</span></h2>
    <dl className="st-spec">
     {premiumOpen(family)?<div><dt>{t('予約で選ぶ','CHOSEN IN BOOKING')}</dt><dd>MODEL / SEASON / LENGTH</dd></div>:<div><dt>{t('モデル','MODEL')}</dt><dd>{t('発表準備中','TO BE ANNOUNCED')}</dd></div>}
     <div><dt>{t('セット 1日','SET · 1 DAY')}</dt><dd>{yen(dayPrice(family==='SKI'?'SKI_SET_ADULT_PREMIUM':'SNOWBOARD_SET_ADULT_PREMIUM'))}</dd></div>
     <div><dt>{t('対象','FOR')}</dt><dd>{t('大人','ADULTS')}</dd></div></dl>
    <div className="st-ph-acts st-pm-acts">{premiumOpen(family)?book('BOOK '+family+' PREMIUM'):<p className="st-soon st-soon--lg">COMING SOON</p>}</div></div>
  </section>;
  body=<>{group('SKI',products.premium)}{group('SNOWBOARD',products.snowboardRide)}</>;
 }else if(path==='prices'){
  head=<PageHead word="PRICES"><p className="st-ph-tax">{t('税込','TAX INCLUDED')}<br/>{t('前日15:00までの事前決済で5%OFF','5% OFF WHEN PAID BY 3:00 PM (JST) THE DAY BEFORE')}</p><div className="st-ph-acts">{book()}</div></PageHead>;
  body=<section className="st-sec st-sec--tight" aria-label={page.title}><PriceExplorer locale={locale} grid={priceGrid()}/><p className="st-one">{t('予約内容に応じた合計は予約画面で確認できます。','Your booking total is shown in the booking flow.')}</p></section>;
 }else if(path==='pickup-return'){
  head=<PageHead word="PICKUP" tone="/ RETURN"><div className="st-ph-acts">{book()}</div></PageHead>;
  const steps:[string,string,string][]=[['01','BOOKING / QR',t('予約確認ページのQRを用意','Have your booking QR ready')],['02','FIT CHECK',t('スタッフとサイズ・用品を確認','Check size and gear with staff')],['03','PICKUP',t('受取店舗で受け取り','Collect at your pickup station')],['04','RETURN',t('返却店舗へ返却','Return at your return station')]];
  body=<>
   <section className="st-sec st-sec--tight st-stores" aria-label={t('店舗','Stores')}>{(['MOUNTAIN_BASE','ONSEN_BASE'] as const).map(s=><div key={s} className="st-store-row"><Link className="st-store-n" href={canonicalPath(locale,STORE_PATH[s])}>{STORE_DISPLAY[s]}</Link><p className="st-store-m">{maps(STORE_GEO[s]).map(([l,h])=><a key={l} className="st-link" href={h} rel="noopener" target="_blank">{l} ↗</a>)}</p></div>)}</section>
   <section className="st-sec" aria-label={t('受取から返却まで','From pickup to return')}><ol className="st-flow">{steps.map(([n,h,d])=><li key={n}><span className="st-flow-n">{n}</span><span className="st-flow-h">{h}</span><span className="st-flow-d">{d}</span></li>)}</ol></section>
   <section className="st-sec" aria-label={t('時間','Times')}><dl className="st-spec">
    <div><dt>{t('営業時間','OPEN')}</dt><dd>8:30–17:00</dd></div>
    <div><dt>{t('開始','START')}</dt><dd>8:30 / 13:00</dd></div>
    <div><dt>{t('返却','RETURN BY')}</dt><dd>12:00 / 17:00</dd></div></dl>
    <p className="st-one">{latePickup}</p>{!legalPublicationComplete(locale)&&<DevelopmentNotice><small>{t('公開文言・利用規約は公開前確認中です。','Public wording and terms remain subject to review.')}</small></DevelopmentNotice>}</section></>;
 }else if(path==='faq'){
  head=<PageHead word="FAQ"><div className="st-ph-acts">{book()}</div></PageHead>;
  body=<section className="st-sec st-sec--tight" aria-label="FAQ"><div className="st-faq">{faq(locale,latePickup).map(([q,a],i)=><details key={i} className="st-faq-i"><summary><span>{q}</span><span className="st-faq-x" aria-hidden="true"/></summary><div className="st-faq-a">{a}</div></details>)}</div></section>;
 }else if(path==='stores/mountain-base'||path==='stores/onsen-base'){
  const s=path==='stores/mountain-base'?'MOUNTAIN_BASE':'ONSEN_BASE',[a,b]=STORE_DISPLAY[s].split(' ');
  head=<PageHead word={a!.toUpperCase()} tone={b?.toUpperCase()}><p className="st-store-m">{maps(STORE_GEO[s]).map(([l,h])=><a key={l} className="st-link" href={h} rel="noopener" target="_blank">{l} ↗</a>)}</p><div className="st-ph-acts">{book()}</div></PageHead>;
  body=<section className="st-sec st-sec--tight" aria-label={page.title}><dl className="st-spec">{page.bullets.map(x=>{const m=/^(\S+)\s+(.+)$/.exec(x);return m?<div key={x}><dt>{m[1]}</dt><dd>{m[2]}</dd></div>:<div key={x}><dd>{x}</dd></div>;})}</dl>
   <p className="st-more"><Link className="st-link" href={r+'/pickup-return'}>PICKUP / RETURN →</Link></p></section>;
 }else{
  head=<PageHead word={page.heading}><div className="st-ph-acts">{book()}</div></PageHead>;
 }
 return <PublicFrame locale={locale} path={path}><main id="main" className="st-page">{head}{preview}{body}{schema}</main></PublicFrame>;
}
