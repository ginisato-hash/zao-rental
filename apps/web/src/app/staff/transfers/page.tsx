import {headers} from 'next/headers';
import {staffState,publicStamp} from '../../../lib/staff-runtime';
import {TransferWorkspace} from '../../../components/TransferWorkspace';
export const dynamic='force-dynamic';
export default async function Page(){const s=await staffState(new Headers(await headers()));if(s.status!=='authorized'||!s.principal.permissions.includes('TRANSFER_VIEW'))return <main><h1>店舗間移動の利用権限が必要です</h1><a href="/staff/login">スタッフログインへ</a></main>;return <TransferWorkspace stamp={publicStamp(s.stamp)} stores={s.principal.storeIds} permissions={s.principal.permissions}/>;}
