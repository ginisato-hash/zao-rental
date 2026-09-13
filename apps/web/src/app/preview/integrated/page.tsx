import {headers} from 'next/headers';
import {staffState,publicStamp} from '../../../lib/staff-runtime';
import {RecommendationWorkspace} from '../../../components/RecommendationWorkspace';
export const dynamic='force-dynamic';
export default async function Page(){const s=await staffState(new Headers(await headers()));if(s.status!=='authorized'||!['HOLD_VIEW','QUOTE_VIEW'].every(p=>s.principal.permissions.includes(p as never)))return <main><h1>推薦プレビューの利用権限が必要です</h1><a href="/staff/login">スタッフログインへ</a></main>;return <RecommendationWorkspace stamp={publicStamp(s.stamp)} stores={s.principal.storeIds} integrated canSelect={['HOLD_EDIT','QUOTE_CREATE'].every(p=>s.principal.permissions.includes(p as never))}/>;}
