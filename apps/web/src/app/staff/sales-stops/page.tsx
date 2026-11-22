import {Suspense} from 'react';
import {StaffSalesStops} from '../../../components/StaffSalesStops';
import {staffShellProps} from '../../../lib/staff-shell-props';
export const dynamic='force-dynamic';
export default async function Page(){
 const {locale,shell}=await staffShellProps();
 if(!shell||!shell.access.inventoryView)return <main><h1>{locale==='en'?'Inventory access required':'在庫閲覧権限が必要です'}</h1><a href="/staff/login">{locale==='en'?'Staff sign-in':'スタッフログインへ'}</a></main>;
 return <Suspense><StaffSalesStops locale={locale} stamp={shell.stamp}/></Suspense>;
}
