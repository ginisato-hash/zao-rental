import {redirect} from 'next/navigation';
import {StaffDashboard} from '../../components/StaffDashboard';
import {staffShellProps} from '../../lib/staff-shell-props';
export const dynamic='force-dynamic';
/** Booqable Dashboard (Issue #47 §2B). The former work board is /staff/today. */
export default async function Page(){
 const {locale,shell}=await staffShellProps();
 if(!shell)return <main><h1>{locale==='en'?'Sign-in required':'認証が必要です'}</h1><p>{locale==='en'?'Staff features are not available.':'スタッフ機能は現在利用できません。'}</p><a href="/staff/login">{locale==='en'?'Staff sign-in':'スタッフログインへ'}</a></main>;
 // UX-01: sign-in lands here (Booqable: the Dashboard is the first screen). Without booking access the staff member goes
 // straight to the first screen they can use instead of a dead end.
 if(!shell.access.bookingView)redirect(shell.access.inventoryView?'/staff/inventory':'/staff/today');
 return <StaffDashboard locale={locale} stamp={shell.stamp} stores={shell.stores}/>;
}
