import {headers} from 'next/headers';
import {staffState,publicStamp} from '../../../lib/staff-runtime';
import {AmendmentWorkspace} from '../../../components/AmendmentWorkspace';
export const dynamic='force-dynamic';
export default async function Page(){const s=await staffState(new Headers(await headers()));if(s.status!=='authorized'||!s.principal.permissions.includes('BOOKING_VIEW'))return <main><h1>予約閲覧権限が必要です</h1><a href="/staff/login">スタッフログイン</a></main>;return <AmendmentWorkspace stamp={publicStamp(s.stamp)} stores={s.principal.storeIds} canAmend={s.principal.permissions.includes('RENTAL_AMEND')} canRefund={s.principal.permissions.includes('REFUND_OVERRIDE')}/>;}
