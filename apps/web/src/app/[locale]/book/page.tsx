import {notFound} from 'next/navigation';
import {GuestBooking} from '../../../components/GuestBooking';
import {legalDocument,legalPath,legalPublicationComplete} from '../../../../../../packages/core/src/content/public-legal';
import {canonicalPath} from '../../../../../../packages/core/src/content/public-pages';
export const metadata={title:'予約 / Booking | ZAO Rental',robots:{index:false,follow:false}};
export default async function Page({params}:{params:Promise<{locale:string}>}){const {locale}=await params;if(locale!=='ja'&&locale!=='en')notFound();const link=(d:'terms'|'cancellation')=>legalDocument(locale,d)?canonicalPath(locale,legalPath(d)):undefined;return <GuestBooking locale={locale} legal={{complete:legalPublicationComplete(locale),terms:link('terms'),cancellation:link('cancellation')}}/>;}
