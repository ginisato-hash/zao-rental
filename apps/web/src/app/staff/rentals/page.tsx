import {StaffGate} from '../../../components/StaffGate';
import {headers} from 'next/headers';
import {staffState,publicStamp} from '../../../lib/staff-runtime';
import {staffShellProps} from '../../../lib/staff-shell-props';
import {CustodyWorkspace} from '../../../components/CustodyWorkspace';
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<{booking?:string}>}){const s=await staffState(new Headers(await headers()));if(s.status!=='authorized'||!s.principal.permissions.includes('BOOKING_VIEW'))return <StaffGate title={['予約閲覧権限が必要です','Booking access required']}/>;const {booking}=await searchParams,{locale}=await staffShellProps();return <><p style={{margin:'0 0 12px'}}><a className="sx-btn" href="/staff/scan">{locale==='en'?'Scan booking or item QR':'予約QR・用品QRを読み取る'}</a></p><CustodyWorkspace stamp={publicStamp(s.stamp)} stores={s.principal.storeIds} canCheckout={s.principal.permissions.includes('RENTAL_CHECKOUT')} canReturn={s.principal.permissions.includes('RENTAL_RETURN')} {...(typeof booking==='string'?{presetBooking:booking}:{})}/></>;}
