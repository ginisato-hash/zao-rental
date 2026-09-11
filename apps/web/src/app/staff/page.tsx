import Link from 'next/link';
import { authorize } from '@rental/core';
import { getPrincipal } from '../../lib/auth';
export const dynamic = 'force-dynamic';
export default async function Page() {
  const access = authorize(await getPrincipal(), ["STAFF", "ADMIN", "MANAGER", "VIEWER"]);
  if (!access.allowed) return <main><h1>認証が必要です</h1><p>スタッフ機能は現在利用できません。</p><Link href="/staff/login">スタッフログインへ</Link></main>;
  return <main><h1>スタッフ入口</h1><Link href="/staff/ledger">道具の台帳へ</Link></main>;
}
