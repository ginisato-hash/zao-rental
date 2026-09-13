import {headers} from 'next/headers';
import {staffState,publicStamp} from '../../../lib/staff-runtime';
import {BookingWorkspace} from '../../../components/BookingWorkspace';
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<{quote?:string}>}){const s=await staffState(new Headers(await headers()));if(s.status!=='authorized'||!s.principal.permissions.includes('BOOKING_VIEW'))return <main><h1>非公開の予約プレビュー</h1><p>利用権限があるスタッフのログインが必要です。</p><a href="/staff/login">スタッフログインへ</a></main>;const q=(await searchParams).quote;return <BookingWorkspace stamp={publicStamp(s.stamp)} quoteId={typeof q==='string'&&/^[a-f0-9-]{36}$/.test(q)?q:null} canCreate={s.principal.permissions.includes('BOOKING_CREATE')}/>;}
