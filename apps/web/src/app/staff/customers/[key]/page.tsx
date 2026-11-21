import {headers} from 'next/headers';
import {StaffCustomer} from '../../../../components/StaffCustomers';
import {staffShellProps} from '../../../../lib/staff-shell-props';
import {staffState} from '../../../../lib/staff-runtime';
export const dynamic='force-dynamic';
export default async function Page({params}:{params:Promise<{key:string}>}){
 const {locale,shell}=await staffShellProps();const {key}=await params;
 if(!shell||!shell.access.bookingView)return <main><h1>{locale==='en'?'Booking access required':'予約閲覧権限が必要です'}</h1><a href="/staff/login">{locale==='en'?'Staff sign-in':'スタッフログインへ'}</a></main>;
 const s=await staffState(new Headers(await headers()));const canLink=s.status==='authorized'&&(s.principal.permissions as string[]).includes('BOOKING_CREATE');
 return <StaffCustomer locale={locale} stamp={shell.stamp} customerKey={decodeURIComponent(key)} canLink={canLink}/>;
}
