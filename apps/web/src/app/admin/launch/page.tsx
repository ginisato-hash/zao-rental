import {StaffGate} from '../../../components/StaffGate';
import {headers} from 'next/headers';
import {staffState,publicStamp} from '../../../lib/staff-runtime';
import {LaunchGateView} from '../../../components/LaunchGateView';
export const dynamic='force-dynamic';
export default async function Page(){const s=await staffState(new Headers(await headers()));if(s.status!=='authorized'||!s.principal.permissions.includes('OPERATIONS_VIEW'))return <StaffGate title={['公開準備状況の閲覧権限が必要です','Launch status access required']}/>;return <LaunchGateView stamp={publicStamp(s.stamp)}/>;}
