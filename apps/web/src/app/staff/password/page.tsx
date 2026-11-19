import {StaffGate} from '../../../components/StaffGate';
import {headers} from 'next/headers';
import {staffState} from '../../../lib/staff-runtime';
import {PasswordChange} from '../../../components/PasswordChange';
export const dynamic='force-dynamic';
export default async function Page(){const state=await staffState(new Headers(await headers()));if(state.status!=='authorized')return <StaffGate title={['認証が必要です','Sign-in required']}/>;return <main><PasswordChange/></main>;}
