import {headers} from 'next/headers';
import {staffState,publicStamp} from '../../../lib/staff-runtime';
import {CustodyWorkspace} from '../../../components/CustodyWorkspace';
export const dynamic='force-dynamic';
export default async function Page(){const s=await staffState(new Headers(await headers()));if(s.status!=='authorized'||!s.principal.permissions.includes('BOOKING_VIEW'))return <main><h1>予約閲覧権限が必要です</h1><a href="/staff/login">スタッフログイン</a></main>;return <><nav><a href="/staff/amendments">変更・返金依頼</a> · <a href="/admin/inventory">棚卸</a></nav><CustodyWorkspace stamp={publicStamp(s.stamp)} stores={s.principal.storeIds} canCheckout={s.principal.permissions.includes('RENTAL_CHECKOUT')} canReturn={s.principal.permissions.includes('RENTAL_RETURN')}/></>;}
