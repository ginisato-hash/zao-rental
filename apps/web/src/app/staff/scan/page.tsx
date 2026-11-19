import {StaffScan} from '../../../components/StaffScan';
import {staffShellProps} from '../../../lib/staff-shell-props';
export const dynamic='force-dynamic';
export default async function Page(){
 const {locale,shell}=await staffShellProps();
 if(!shell||!(shell.access.bookingView||shell.access.inventoryView))return <main><h1>{locale==='en'?'Access required':'閲覧権限が必要です'}</h1><a href="/staff/login">{locale==='en'?'Staff sign-in':'スタッフログインへ'}</a></main>;
 return <StaffScan locale={locale} stamp={shell.stamp} canOrders={shell.access.bookingView} canItems={shell.access.inventoryView}/>;
}
