import {notFound} from 'next/navigation';
import {ConfirmedBooking} from '../../../components/BookingAccess';
export const dynamic='force-dynamic';
export const metadata={robots:{index:false,follow:false},referrer:'no-referrer' as const};
export default async function Page({params}:{params:Promise<{locale:string}>}){const {locale}=await params;if(!['ja','en'].includes(locale))notFound();return <main style={{maxWidth:720,margin:'auto',padding:20,overflowWrap:'anywhere'}}><ConfirmedBooking/></main>;}
