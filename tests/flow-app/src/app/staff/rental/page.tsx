import {headers} from 'next/headers';
import {staffState,publicStamp} from '../../../../../../apps/web/src/lib/staff-runtime';
import {CustodyWorkspace} from '../../../../../../apps/web/src/components/CustodyWorkspace';
export const dynamic='force-dynamic';
export default async function Page(){const s=await staffState(new Headers(await headers()));if(s.status!=='authorized'||!s.principal.permissions.includes('BOOKING_VIEW'))return <main><h1>貸出返却の利用権限が必要です</h1><a href="/staff/login">スタッフログインへ</a></main>;return <CustodyWorkspace stamp={publicStamp(s.stamp)} stores={s.principal.storeIds} canCheckout={s.principal.permissions.includes('RENTAL_CHECKOUT')} canReturn={s.principal.permissions.includes('RENTAL_RETURN')}/>;}
