import {canManage} from '../../../../../../packages/auth/src/staff-auth';
import {headers} from 'next/headers';
import {staffState,publicStamp} from '../../../lib/staff-runtime';
import {StaffLedger} from '../../../components/StaffLedger';
export const dynamic='force-dynamic';
export default async function Page(){
 const state=await staffState(new Headers(await headers()));
 if(state.status!=='authorized'||!state.principal.permissions.includes('INVENTORY_VIEW')||!state.principal.storeIds.length)return <main><h1>{state.status==='anonymous'?'認証が必要です':'台帳の利用権限がありません'}</h1><p>台帳はスタッフ認証と担当店舗の設定が完了するまで利用できません。</p><a href="/staff/login">スタッフログインへ</a></main>;
 return <StaffLedger key={publicStamp(state.stamp)} stamp={publicStamp(state.stamp)} canEdit={state.principal.permissions.includes('INVENTORY_EDIT')} canEditGlobal={state.principal.scope==='ALL'} canManageStaff={canManage(state.principal)}/>;
}
