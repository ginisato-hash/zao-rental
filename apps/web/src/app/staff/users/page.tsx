import {headers} from 'next/headers';
import {StaffSessionBoundary} from '../../../components/StaffSessionBoundary';
import {staffState,publicStamp} from '../../../lib/staff-runtime';
import {canManage} from '../../../../../../packages/auth/src/staff-auth';
import {StaffManagement} from '../../../components/StaffManagement';
export const dynamic='force-dynamic';
export default async function Page(){const state=await staffState(new Headers(await headers()));if(state.status!=='authorized'||!canManage(state.principal))return <main><h1>スタッフ管理の権限がありません</h1><a href="/staff/login">ログインへ</a></main>;return <StaffSessionBoundary stamp={publicStamp(state.stamp)}><StaffManagement stamp={publicStamp(state.stamp)}/></StaffSessionBoundary>;}
