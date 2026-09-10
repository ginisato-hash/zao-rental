import { authorize } from '@rental/core';
import { getPrincipal } from '../../../lib/auth';
export const dynamic = 'force-dynamic';
export async function GET() {
  const access = authorize(await getPrincipal(), ["STAFF", "ADMIN"]);
  if (!access.allowed) return Response.json({ error: 'AUTHENTICATION_REQUIRED' }, { status: access.status, headers: { 'Cache-Control': 'no-store' } });
  return Response.json({ error: 'NOT_IMPLEMENTED' }, { status: 501 });
}
