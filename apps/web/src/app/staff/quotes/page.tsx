import {StaffGate} from '../../../components/StaffGate';
import {headers} from 'next/headers';
import {staffState,publicStamp} from '../../../lib/staff-runtime';
import {QuoteWorkspace} from '../../../components/QuoteWorkspace';
export const dynamic='force-dynamic';
export default async function Page(){const s=await staffState(new Headers(await headers()));if(s.status!=='authorized'||!s.principal.permissions.includes('QUOTE_VIEW'))return <StaffGate title={['見積の利用権限が必要です','Quote access required']}/>;return <QuoteWorkspace stamp={publicStamp(s.stamp)} stores={s.principal.storeIds} canCreate={s.principal.permissions.includes('QUOTE_CREATE')} canConfigure={s.principal.role==='ADMIN'&&s.principal.scope==='ALL'&&s.principal.permissions.includes('PRICE_EDIT')}/>;}
