import {GuestBooking} from '../../../../components/GuestBooking';
import {StaffSessionBoundary} from '../../../../components/StaffSessionBoundary';
import {staffShellProps} from '../../../../lib/staff-shell-props';
import {legalDocument,legalPath,legalPublicationComplete} from '../../../../../../../packages/core/src/content/public-legal';
import {canonicalPath} from '../../../../../../../packages/core/src/content/public-pages';
import {currentRentalTerms} from '../../../../../../../packages/core/src/content/rental-terms';
import '../../../../components/guest.css';
export const dynamic='force-dynamic';
export const metadata={title:'New order | SALOMON RENTAL STATION ZAO',robots:{index:false,follow:false}};
/** Booqable New order: the same steps, stock/price checks and terms as the public booking, run as the signed-in staff
 * member. Payment is the customer's own explicit card entry in Square's field on this screen (no keyed-in card, no
 * saved card, no Terminal/Invoice/payment link). Without the Production commercial composition the API answers 503. */
export default async function Page(){
 const {locale,shell}=await staffShellProps();
 if(!shell||!shell.access.bookingCreate)return <main><h1>{locale==='en'?'Booking creation permission required':'予約作成権限が必要です'}</h1><a href="/staff/orders">{locale==='en'?'Orders':'予約一覧へ'}</a></main>;
 const link=(d:'terms'|'cancellation')=>legalDocument(locale,d)?canonicalPath(locale,legalPath(d)):undefined;
 return <StaffSessionBoundary stamp={shell.stamp}><GuestBooking locale={locale} staff={{stamp:shell.stamp}} legal={{complete:legalPublicationComplete(locale),terms:link('terms'),cancellation:link('cancellation'),termsBundle:{...currentRentalTerms()}}}/></StaffSessionBoundary>;
}
