import {StaffGate} from '../../../components/StaffGate';
import {headers} from 'next/headers';
import {staffState,publicStamp} from '../../../lib/staff-runtime';
import {WearWorkspace} from '../../../components/WearWorkspace';
export const dynamic='force-dynamic';
export default async function Page(){const s=await staffState(new Headers(await headers()));if(s.status!=='authorized'||!s.principal.permissions.includes('INVENTORY_VIEW'))return <StaffGate title={['ウェア台帳の利用権限が必要です','Wear ledger access required']}/>;return <WearWorkspace stamp={publicStamp(s.stamp)} stores={s.principal.storeIds}/>;}
