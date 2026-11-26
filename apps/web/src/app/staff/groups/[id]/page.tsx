import {Suspense} from 'react';
import {headers} from 'next/headers';
import {StaffGroupDetail} from '../../../../components/StaffGroupDetail';
import {staffShellProps} from '../../../../lib/staff-shell-props';
import {staffState} from '../../../../lib/staff-runtime';
export const dynamic='force-dynamic';
export default async function Page({params}:{params:Promise<{id:string}>}){
 const {locale,shell}=await staffShellProps();const {id}=await params;
 if(!shell||!shell.access.groupView)return <main><h1>{locale==='en'?'Administrator access required':'管理者権限が必要です'}</h1><a href="/staff/login">{locale==='en'?'Staff sign-in':'スタッフログインへ'}</a></main>;
 const s=await staffState(new Headers(await headers()));const perms=s.status==='authorized'?(s.principal.permissions as string[]):[];
 const has=(p:string)=>perms.includes(p);
 return <Suspense><StaffGroupDetail locale={locale} stamp={shell.stamp} id={id} can={{approve:has('GROUP_APPROVE'),discount:has('GROUP_DISCOUNT'),release:has('GROUP_RELEASE'),cancel:has('GROUP_CANCEL'),payment:has('GROUP_PAYMENT_RECORD')}}/></Suspense>;
}
