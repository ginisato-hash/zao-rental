import {StaffLogin} from '../../../components/StaffLogin';
import {getRuntime} from '../../../lib/staff-runtime';
export const dynamic='force-dynamic';
export default function Page(){return <main className="staff-account"><h1>スタッフログイン</h1><StaffLogin configured={Boolean(getRuntime()?.auth)}/><p>台帳の利用には、別途承認されたスタッフ登録が必要です。</p><a href="/staff/ledger">台帳へ</a></main>;}
