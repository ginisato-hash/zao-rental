import Link from 'next/link';
import { authorize } from '@rental/core';
import { getPrincipal } from '../../lib/auth';
export const dynamic = 'force-dynamic';
export default async function Page() {
  const access = authorize(await getPrincipal(), ["ADMIN"]);
  if (!access.allowed) return <main><h1>認証が必要です</h1><p>管理者機能は現在利用できません。</p><Link href="/">戻る</Link></main>;
  return <main><h1>準備中</h1></main>;
}
