import {StaffProduct} from '../../../../components/StaffProduct';
import {staffShellProps} from '../../../../lib/staff-shell-props';
export const dynamic='force-dynamic';
export default async function Page({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{store?:string}>}){
 const {locale,shell}=await staffShellProps();const {id}=await params;const {store}=await searchParams;
 if(!shell||!shell.access.inventoryView)return <main><h1>{locale==='en'?'Inventory access required':'在庫閲覧権限が必要です'}</h1><a href="/staff/login">{locale==='en'?'Staff sign-in':'スタッフログインへ'}</a></main>;
 const station=store&&shell.stores.includes(store)?store:shell.stores[0]!;
 return <StaffProduct locale={locale} stamp={shell.stamp} id={id} store={station} canCheck={shell.access.holdView}/>;
}
