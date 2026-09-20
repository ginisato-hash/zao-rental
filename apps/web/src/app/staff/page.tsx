import {headers} from 'next/headers';
import {canManage} from '../../../../../packages/auth/src/staff-auth';
import {staffState,publicStamp} from '../../lib/staff-runtime';
import {StaffHome} from '../../components/StaffHome';
export const dynamic = 'force-dynamic';
export default async function Page() {
  const s = await staffState(new Headers(await headers()));
  if (s.status !== 'authorized') return <main><h1>認証が必要です</h1><p>スタッフ機能は現在利用できません。</p><a href="/staff/login">スタッフログインへ</a></main>;
  return <StaffHome key={publicStamp(s.stamp)} stamp={publicStamp(s.stamp)} stores={s.principal.storeIds} canBookingView={s.principal.permissions.includes('BOOKING_VIEW')} canCheckout={s.principal.permissions.includes('RENTAL_CHECKOUT')} canReturn={s.principal.permissions.includes('RENTAL_RETURN')} canOperationsView={s.principal.permissions.includes('OPERATIONS_VIEW')} canInventoryView={s.principal.permissions.includes('INVENTORY_VIEW')} canTransferView={s.principal.permissions.includes('TRANSFER_VIEW')} canQuoteView={s.principal.permissions.includes('QUOTE_VIEW')} canHoldView={s.principal.permissions.includes('HOLD_VIEW')} canManageStaff={canManage(s.principal)} />;
}
