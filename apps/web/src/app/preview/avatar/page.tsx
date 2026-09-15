import {headers} from 'next/headers';
import {notFound} from 'next/navigation';
import {staffState,getRuntime} from '../../../lib/staff-runtime';
import {publicRuntime} from '../../../lib/public-runtime';
import {AvatarCustomerPreview} from '../../../components/AvatarCustomerPreview';
import {loadAvatarPreview} from '../../../../../../packages/core/src/avatar/preview';
import {PostgresAvatarVisuals} from '../../../../../../packages/db/src/avatar-visuals';
import {avatarUuid} from '../../../../../../packages/core/src/avatar/media';
import {HoldError} from '../../../../../../packages/contracts/src/hold';
export const dynamic='force-dynamic';
export const metadata={title:'ZAO Rental | Avatar staff preview',robots:{index:false,follow:false}};
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const h=new Headers(await headers()),s=await staffState(h);
 if(s.status!=='authorized'||!['BOOKING_VIEW','HOLD_VIEW','QUOTE_VIEW'].every(p=>s.principal.permissions.includes(p as never)))return <main className="avatar-private"><h1>Staff preview · 非公開プレビュー</h1><p>スタッフのログインと閲覧権限が必要です。Staff sign-in and read permissions are required.</p><a href="/staff/login">スタッフログイン / Staff sign in</a></main>;
 const q=await searchParams,locale=q.locale==='en'?'en':'ja';
 if(Object.keys(q).some(k=>!['preview','member','locale'].includes(k))||q.locale!==undefined&&!['ja','en'].includes(q.locale as string))notFound();
 if(q.preview===undefined&&q.member===undefined)return <main className="avatar-private"><h1>{locale==='ja'?'見た目のスタッフプレビュー':'Staff visual preview'}</h1><p>{locale==='ja'?'認可済みの保存済み推薦IDと利用者キーで開いてください。新しい推薦は作成しません。':'Open with an authorized saved recommendation ID and member key. No new recommendation is created.'}</p></main>;
 if(typeof q.preview!=='string'||!avatarUuid.test(q.preview)||typeof q.member!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(q.member))notFound();
 const runtime=getRuntime(),content=publicRuntime();if(!runtime||!content)notFound();
 let payloads;
 try{payloads=await loadAvatarPreview(runtime.recommendationPool,s.principal,q.preview,q.member,new PostgresAvatarVisuals(content.readPool),new Date());}catch(e){if(e instanceof HoldError&&e.status===403)notFound();throw e;}
 const after=await staffState(h);if(after.status!=='authorized'||after.stamp!==s.stamp)notFound();
 return <AvatarCustomerPreview payloads={payloads} locale={locale}/>;
}
