import {notFound} from 'next/navigation';
import {GroupApplication} from '../../../../../components/GroupApplication';
import {PublicFrame} from '../../../../../components/PublicPage';
import {legalDocument,legalPath} from '../../../../../../../../packages/core/src/content/public-legal';
import {canonicalPath} from '../../../../../../../../packages/core/src/content/public-pages';
import '../../../../../components/guest.css';
import '../../../../../components/group.css';
export const dynamic='force-dynamic';
// Permanent group entrance: never indexed, never followed, no referrer (the token is part of this URL), not linked from any public page.
export const metadata={title:'団体のお申し込み / Group request | SALOMON RENTAL STATION ZAO',robots:{index:false,follow:false,nocache:true},referrer:'no-referrer' as const};
export default async function Page({params}:{params:Promise<{locale:string;token:string;rest?:string[]}>}){
 const {locale,token,rest}=await params;
 if(locale!=='ja'&&locale!=='en')notFound();
 if(!/^[A-Za-z0-9_-]{32,128}$/.test(token)||(rest&&(rest.length!==1||!/^[a-f0-9-]{36}$/.test(rest[0]!))))notFound();
 const link=(d:'terms'|'cancellation')=>legalDocument(locale,d)?canonicalPath(locale,legalPath(d)):undefined;
 return <PublicFrame locale={locale} path={'group/'+token} final={false}><main id="main" className="guest-main group-main"><GroupApplication locale={locale} token={token} groupId={rest?.[0]??null} legal={{terms:link('terms'),cancellation:link('cancellation')}}/></main></PublicFrame>;
}
