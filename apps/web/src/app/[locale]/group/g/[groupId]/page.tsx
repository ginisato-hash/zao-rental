import {notFound} from 'next/navigation';
import {GroupApplication} from '../../../../../components/GroupApplication';
import {PublicFrame} from '../../../../../components/PublicPage';
import {legalDocument,legalPath} from '../../../../../../../../packages/core/src/content/public-legal';
import {canonicalPath} from '../../../../../../../../packages/core/src/content/public-pages';
import '../../../../../components/guest.css';
import '../../../../../components/group.css';
export const dynamic='force-dynamic';
// Owner page of ONE existing group (the target of every group e-mail). It carries a group id only (not a secret) and needs no entrance
// token: access is the group's owner cookie or the resume key (fragment / pasted). Never indexed, no referrer.
export const metadata={title:'団体のお申し込み / Group request | SALOMON RENTAL STATION ZAO',robots:{index:false,follow:false,nocache:true},referrer:'no-referrer' as const};
export default async function Page({params}:{params:Promise<{locale:string;groupId:string}>}){
 const {locale,groupId}=await params;
 if(locale!=='ja'&&locale!=='en')notFound();
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(groupId))notFound();
 const link=(d:'terms'|'cancellation')=>legalDocument(locale,d)?canonicalPath(locale,legalPath(d)):undefined;
 return <PublicFrame locale={locale} path={'group/g/'+groupId} final={false}><main id="main" className="guest-main group-main"><GroupApplication locale={locale} token={null} groupId={groupId} legal={{terms:link('terms'),cancellation:link('cancellation')}}/></main></PublicFrame>;
}
