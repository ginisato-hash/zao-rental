import {headers} from 'next/headers';
import {staffState,publicStamp} from '../../../lib/staff-runtime';
import {HoldWorkspace} from '../../../components/HoldWorkspace';
export const dynamic='force-dynamic';
export default async function Page(){const s=await staffState(new Headers(await headers()));
 if(s.status!=='authorized'||!s.principal.permissions.includes('HOLD_VIEW'))return <main><h1>期間在庫の利用権限が必要です</h1><a href="/staff/login">スタッフログインへ</a></main>;
 return <HoldWorkspace key={publicStamp(s.stamp)} stamp={publicStamp(s.stamp)} stores={s.principal.storeIds} canEdit={s.principal.permissions.includes('HOLD_EDIT')} canOverride={s.principal.permissions.includes('INVENTORY_BUFFER_OVERRIDE')}/>;
}
