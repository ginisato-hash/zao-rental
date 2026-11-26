import {StaffOrders} from '../../../components/StaffOrders';
import {staffShellProps} from '../../../lib/staff-shell-props';
export const dynamic='force-dynamic';
export default async function Page(){
 const {locale,shell}=await staffShellProps();
 if(!shell||!shell.access.bookingView)return <main><h1>{locale==='en'?'Booking access required':'予約閲覧権限が必要です'}</h1><a href="/staff/login">{locale==='en'?'Staff sign-in':'スタッフログインへ'}</a></main>;
 return <StaffOrders locale={locale} stamp={shell.stamp} stores={shell.stores} canCreate={shell.access.bookingCreate} more={{quotes:shell.access.quoteView,holds:shell.access.holdView,recommendations:shell.access.quoteView&&shell.access.holdView,amendments:shell.access.bookingView,groups:Boolean(shell.access.groupView)}}/>;
}
