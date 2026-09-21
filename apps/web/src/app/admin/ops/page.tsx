import Link from 'next/link';
import {headers} from 'next/headers';
import {staffState,publicStamp} from '../../../lib/staff-runtime';
import {OpsWorkspace} from '../../../components/OpsWorkspace';
export const dynamic='force-dynamic';
export default async function Page(){const s=await staffState(new Headers(await headers()));if(s.status!=='authorized'||!s.principal.permissions.includes('OPERATIONS_VIEW'))return <main><h1>運用状況の閲覧権限が必要です</h1><Link href="/staff/login">スタッフログイン</Link></main>;return <OpsWorkspace stamp={publicStamp(s.stamp)} stores={s.principal.storeIds} systemScope={s.principal.scope==='ALL'} canAcknowledge={s.principal.permissions.includes('OPERATIONS_ACKNOWLEDGE')}/>;}
