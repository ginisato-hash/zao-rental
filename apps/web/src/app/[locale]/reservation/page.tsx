import {notFound} from 'next/navigation';
import {ConfirmedBooking} from '../../../components/BookingAccess';
import {PublicFrame} from '../../../components/PublicPage';
import '../../../components/guest.css';
export const dynamic='force-dynamic';
export const metadata={robots:{index:false,follow:false},referrer:'no-referrer' as const};
export default async function Page({params}:{params:Promise<{locale:string}>}){const {locale}=await params;if(!['ja','en'].includes(locale))notFound();return <PublicFrame locale={locale as 'ja'|'en'} path="reservation"><main className="guest-main" style={{overflowWrap:'anywhere'}}><ConfirmedBooking locale={locale}/></main></PublicFrame>;}
