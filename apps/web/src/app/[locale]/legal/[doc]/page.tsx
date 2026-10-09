export const dynamic='force-dynamic';
import Link from 'next/link';
import {notFound} from 'next/navigation';
import {legalDocument,approvedLegalDocs,legalPath} from '../../../../../../../packages/core/src/content/public-legal';
import {canonicalPath,type Locale} from '../../../../../../../packages/core/src/content/public-pages';
import {publicMetadata} from '../../../../lib/public-seo';
import '../../../../components/public.css';
type Props={params:Promise<{locale:string;doc:string}>};
const resolve=async(p:Props)=>{const {locale,doc}=await p.params;return locale==='ja'||locale==='en'?legalDocument(locale as Locale,doc):null;};
export async function generateMetadata(p:Props){const d=await resolve(p);if(!d)return {title:'Not found',robots:{index:false,follow:false}};return publicMetadata(d.locale,legalPath(d.doc),d.title+' | ZAO Rental',d.title);}
/** Owner-approved legal/policy text only; an unapproved document does not exist publicly. */
export default async function Page(p:Props){const d=await resolve(p);if(!d)notFound();const ja=d.locale==='ja';
 return <div className="public-shell" lang={d.locale}><header className="public-header"><Link className="wordmark" href={'/'+d.locale}>ZAO<span>RENTAL</span></Link></header>
 <main className="public-main public-legal"><h1>{d.title}</h1>{d.sections.map((s,i)=><section key={i} className="public-detail">{s.heading&&<h2>{s.heading}</h2>}{s.paragraphs.map((t,j)=><p key={j}>{t}</p>)}</section>)}
 <p className="public-legal-meta">{ja?'制定・改定日':'Effective'}: {d.approvedAt.slice(0,10)}</p></main>
 <footer className="public-footer"><strong>ZAO RENTAL</strong><nav aria-label={ja?'規約・表記':'Legal'}>{approvedLegalDocs(d.locale).map(x=>{const o=legalDocument(d.locale,x)!;return <Link key={x} href={canonicalPath(d.locale,legalPath(x))}>{o.title}</Link>;})}</nav></footer></div>;}
