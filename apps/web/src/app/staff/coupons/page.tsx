import {Suspense} from 'react';
import {StaffCoupons} from '../../../components/StaffCoupons';
import {staffShellProps} from '../../../lib/staff-shell-props';
import {couponProductOptions} from '../../../lib/coupon-products';
export const dynamic='force-dynamic';
export default async function Page(){
 const {locale,shell}=await staffShellProps();
 if(!shell||!shell.access.quoteView)return <main><h1>{locale==='en'?'Quote access required':'見積の閲覧権限が必要です'}</h1><a href="/staff/login">{locale==='en'?'Staff sign-in':'スタッフログインへ'}</a></main>;
 return <Suspense><StaffCoupons locale={locale} stamp={shell.stamp} products={couponProductOptions()}/></Suspense>;
}
