import {StaffGate} from '../../../components/StaffGate';
import {headers} from 'next/headers';
import {canManage} from '../../../../../../packages/auth/src/staff-auth';
import {staffState,publicStamp} from '../../../lib/staff-runtime';
import {StaffHome} from '../../../components/StaffHome';
export const dynamic = 'force-dynamic';
export default async function Page() {
  const s = await staffState(new Headers(await headers()));
  if (s.status !== 'authorized') return <StaffGate title={['認証が必要です','Sign-in required']} body={['スタッフ機能を使うにはログインしてください。','Sign in to use staff features.']}/>;
  return <StaffHome key={publicStamp(s.stamp)} stamp={publicStamp(s.stamp)} stores={s.principal.storeIds} canBookingView={s.principal.permissions.includes('BOOKING_VIEW')} canCheckout={s.principal.permissions.includes('RENTAL_CHECKOUT')} canReturn={s.principal.permissions.includes('RENTAL_RETURN')} canOperationsView={s.principal.permissions.includes('OPERATIONS_VIEW')} canInventoryView={s.principal.permissions.includes('INVENTORY_VIEW')} canTransferView={s.principal.permissions.includes('TRANSFER_VIEW')} canQuoteView={s.principal.permissions.includes('QUOTE_VIEW')} canHoldView={s.principal.permissions.includes('HOLD_VIEW')} canManageStaff={canManage(s.principal)} />;
}
