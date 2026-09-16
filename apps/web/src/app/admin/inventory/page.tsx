import Link from 'next/link';
import {headers} from 'next/headers';
import {staffState,publicStamp} from '../../../lib/staff-runtime';
import {InventoryOperationsWorkspace} from '../../../components/InventoryOperationsWorkspace';
export const dynamic='force-dynamic';
export default async function Page(){const s=await staffState(new Headers(await headers()));if(s.status!=='authorized'||!s.principal.permissions.includes('INVENTORY_VIEW'))return <main><h1>在庫閲覧権限が必要です</h1><Link href="/staff/login">スタッフログイン</Link></main>;return <InventoryOperationsWorkspace stamp={publicStamp(s.stamp)} stores={s.principal.storeIds} canEdit={s.principal.permissions.includes('INVENTORY_EDIT')} canReconcile={s.principal.permissions.includes('INVENTORY_RECONCILE')}/>;}
