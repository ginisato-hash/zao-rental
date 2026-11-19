import {Suspense} from 'react';
import {StaffDashboard} from '../../components/StaffDashboard';
import {staffShellProps} from '../../lib/staff-shell-props';
export const dynamic='force-dynamic';
/** Booqable Dashboard (Issue #47 §2B). The former work board is /staff/today. */
export default async function Page(){
 const {locale,shell}=await staffShellProps();
 if(!shell)return <main><h1>{locale==='en'?'Sign-in required':'認証が必要です'}</h1><p>{locale==='en'?'Staff features are not available.':'スタッフ機能は現在利用できません。'}</p><a href="/staff/login">{locale==='en'?'Staff sign-in':'スタッフログインへ'}</a></main>;
 if(!shell.access.bookingView)return <main><h1>{locale==='en'?'Dashboard':'ダッシュボード'}</h1><p>{locale==='en'?'Booking access is required for the dashboard.':'ダッシュボードの表示には予約閲覧権限が必要です。'}</p><a href="/staff/today">{locale==='en'?'Today’s work':'当日作業へ'}</a></main>;
 return <Suspense><StaffDashboard locale={locale} stamp={shell.stamp} stores={shell.stores}/></Suspense>;
}
