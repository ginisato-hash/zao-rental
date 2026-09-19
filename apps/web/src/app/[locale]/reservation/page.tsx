import {notFound} from 'next/navigation';
import Link from 'next/link';
import {ConfirmedBooking} from '../../../components/BookingAccess';
import '../../../components/public.css';
import '../../../components/guest.css';
export const dynamic='force-dynamic';
export const metadata={robots:{index:false,follow:false},referrer:'no-referrer' as const};
export default async function Page({params}:{params:Promise<{locale:string}>}){const {locale}=await params;if(!['ja','en'].includes(locale))notFound();const ja=locale==='ja';return <div className="public-shell" lang={locale}><header className="public-header"><Link className="wordmark" href={'/'+locale}>ZAO<span>RENTAL</span></Link><nav aria-label={ja?'メインナビゲーション':'Main navigation'}><Link href={'/'+locale+'/book'}>{ja?'予約する':'Book now'}</Link></nav></header><main className="guest-main" style={{overflowWrap:'anywhere'}}><ConfirmedBooking locale={locale}/></main></div>;}
