import {headers} from 'next/headers';
import {staffState} from '../../../lib/staff-runtime';
import {PasswordChange} from '../../../components/PasswordChange';
export const dynamic='force-dynamic';
export default async function Page(){const state=await staffState(new Headers(await headers()));if(state.status!=='authorized')return <main><h1>認証が必要です</h1><a href="/staff/login">ログインへ</a></main>;return <main><h1>パスワード変更</h1><PasswordChange/></main>;}
