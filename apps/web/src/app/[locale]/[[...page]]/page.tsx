export const dynamic='force-dynamic';
import {notFound} from 'next/navigation';
import {pageContent,latePickupCopy,publicModels} from '../../../lib/public-content';
import {publicOrigin,type Locale} from '../../../../../../packages/core/src/content/public-pages';
import {PublicPage} from '../../../components/PublicPage';
import {publicMetadata} from '../../../lib/public-seo';
type Props={params:Promise<{locale:string;page?:string[]}>;searchParams:Promise<Record<string,string|string[]|undefined>>};
export async function generateMetadata(p:Props){const {locale,page=[]}=await p.params,item=['ja','en'].includes(locale)?await pageContent(locale as Locale,page.join('/')):null;if(!item)return {title:'Not found',robots:{index:false,follow:false}};return publicMetadata(locale as Locale,item.path,item.title,item.summary,Object.keys(await p.searchParams).length>0);}
export default async function Page(p:Props){const {locale,page=[]}=await p.params,item=['ja','en'].includes(locale)?await pageContent(locale as Locale,page.join('/')):null;if(!item)notFound();return <PublicPage page={item} locale={locale as Locale} origin={publicOrigin(process.env.ZAO_PUBLIC_ORIGIN)} latePickup={await latePickupCopy(locale as Locale)} models={page.join('/')==='rental/premium'?await publicModels():[]}/>;}
