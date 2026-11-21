import {cookies} from 'next/headers';
import {STAFF_LOCALE_COOKIE,staffLocaleFrom} from './staff-i18n';

/** Server-rendered access gate in the saved staff language (Issue #47: no Japanese-only fallback screens). */
export async function StaffGate({title,body,href='/staff/login',link}:{title:readonly [string,string];body?:readonly [string,string];href?:string;link?:readonly [string,string]}){
 const en=staffLocaleFrom((await cookies()).get(STAFF_LOCALE_COOKIE)?.value)==='en',pick=(v:readonly [string,string])=>v[en?1:0];
 return <main><h1>{pick(title)}</h1>{body&&<p>{pick(body)}</p>}<a href={href}>{pick(link??['スタッフログインへ','Staff sign-in'])}</a></main>;
}
