import {headers} from 'next/headers';
import {staffState,publicStamp} from '../../../lib/staff-runtime';
import {WearWorkspace} from '../../../components/WearWorkspace';
export const dynamic='force-dynamic';
export default async function Page(){const s=await staffState(new Headers(await headers()));if(s.status!=='authorized'||!s.principal.permissions.includes('INVENTORY_VIEW'))return <main><h1>ウェア台帳の利用権限が必要です</h1><a href="/staff/login">スタッフログインへ</a></main>;return <WearWorkspace stamp={publicStamp(s.stamp)} stores={s.principal.storeIds}/>;}
