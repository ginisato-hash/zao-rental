import {StaffGate} from '../../../components/StaffGate';
import {headers} from 'next/headers';
import {staffState,publicStamp} from '../../../lib/staff-runtime';
import {CustodyWorkspace} from '../../../components/CustodyWorkspace';
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<{booking?:string}>}){const s=await staffState(new Headers(await headers()));if(s.status!=='authorized'||!s.principal.permissions.includes('BOOKING_VIEW'))return <StaffGate title={['予約閲覧権限が必要です','Booking access required']}/>;const {booking}=await searchParams;return <><CustodyWorkspace stamp={publicStamp(s.stamp)} stores={s.principal.storeIds} canCheckout={s.principal.permissions.includes('RENTAL_CHECKOUT')} canReturn={s.principal.permissions.includes('RENTAL_RETURN')} {...(typeof booking==='string'?{presetBooking:booking}:{})}/></>;}
