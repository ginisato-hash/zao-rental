import Link from 'next/link';
import {headers} from 'next/headers';
import {staffState,publicStamp} from '../../../lib/staff-runtime';
import {NotificationWorkspace} from '../../../components/NotificationWorkspace';
export const dynamic='force-dynamic';
export default async function Page(){const s=await staffState(new Headers(await headers()));if(s.status!=='authorized'||!s.principal.permissions.includes('BOOKING_VIEW'))return <main><h1>予約閲覧権限が必要です</h1><Link href="/staff/login">スタッフログイン</Link></main>;return <NotificationWorkspace stamp={publicStamp(s.stamp)} stores={s.principal.storeIds} canResend={s.principal.permissions.includes('NOTIFICATION_RESEND')}/>;}
