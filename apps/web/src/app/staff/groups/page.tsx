import {Suspense} from 'react';
import {headers} from 'next/headers';
import {StaffGroups} from '../../../components/StaffGroups';
import {staffShellProps} from '../../../lib/staff-shell-props';
import {staffState} from '../../../lib/staff-runtime';
export const dynamic='force-dynamic';
/** Group orders (ADMIN + GROUP_VIEW). The menu entry is only a convenience: every read and write is re-authorized by the server. */
export default async function Page(){
 const {locale,shell}=await staffShellProps();
 if(!shell||!shell.access.groupView)return <main><h1>{locale==='en'?'Administrator access required':'管理者権限が必要です'}</h1><a href="/staff/login">{locale==='en'?'Staff sign-in':'スタッフログインへ'}</a></main>;
 const s=await staffState(new Headers(await headers()));const perms=s.status==='authorized'?(s.principal.permissions as string[]):[];
 return <Suspense><StaffGroups locale={locale} stamp={shell.stamp} stores={shell.stores} canEntrance={perms.includes('GROUP_ENTRANCE_MANAGE')}/></Suspense>;
}
