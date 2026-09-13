import {notFound} from 'next/navigation';
import {GuestRecovery} from '../../../components/GuestRecovery';
import {GuestBooking} from '../../../components/GuestBooking';
export const metadata={title:'Booking preview | ZAO Rental',robots:{index:false,follow:false}};
export default async function Page({params}:{params:Promise<{locale:string}>}){const {locale}=await params;if(locale!=='ja'&&locale!=='en')notFound();return <><GuestBooking locale={locale}/><GuestRecovery locale={locale}/></>;}
