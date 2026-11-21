import {headers} from 'next/headers';
import {StaffOrderDetail} from '../../../../components/StaffOrderDetail';
import {staffShellProps} from '../../../../lib/staff-shell-props';
import {staffState} from '../../../../lib/staff-runtime';
export const dynamic='force-dynamic';
/** Read-only order detail (BOOKING_VIEW). Actions are offered per permission; their own screens enforce them again. */
export default async function Page({params}:{params:Promise<{id:string}>}){
 const {locale,shell}=await staffShellProps();const {id}=await params;
 if(!shell||!shell.access.bookingView)return <main><h1>{locale==='en'?'Booking access required':'予約閲覧権限が必要です'}</h1><a href="/staff/login">{locale==='en'?'Staff sign-in':'スタッフログインへ'}</a></main>;
 const s=await staffState(new Headers(await headers()));const perms=s.status==='authorized'?(s.principal.permissions as string[]):[];
 return <StaffOrderDetail locale={locale} stamp={shell.stamp} id={id} can={{checkout:perms.includes('RENTAL_CHECKOUT'),ret:perms.includes('RENTAL_RETURN'),amend:perms.includes('RENTAL_AMEND')}}/>;
}
