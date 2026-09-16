import Link from 'next/link';
import {headers} from 'next/headers';
import {staffState,publicStamp} from '../../../lib/staff-runtime';
import {PriceAdminWorkspace} from '../../../components/PriceAdminWorkspace';
export const dynamic='force-dynamic';
export default async function Page(){const s=await staffState(new Headers(await headers()));if(s.status!=='authorized'||!s.principal.permissions.includes('PRICE_EDIT')||s.principal.role!=='ADMIN'||s.principal.scope!=='ALL')return <main><h1>料金管理の明示権限が必要です</h1><Link href="/staff/login">スタッフログイン</Link></main>;return <PriceAdminWorkspace stamp={publicStamp(s.stamp)}/>;}
