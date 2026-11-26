import {cookies,headers} from 'next/headers';
import {canManage} from '../../../../packages/auth/src/staff-auth';
import {canCreateStaffOrder} from '../../../../packages/auth/src/staff-order-access';
import {staffState,publicStamp} from './staff-runtime';
import {STAFF_LOCALE_COOKIE,staffLocaleFrom,type StaffLocale} from '../components/staff-i18n';
import type {ShellAccess} from '../components/StaffShell';

/** Server-side shell inputs. Unauthenticated requests (login, logout) get no shell and no staff data. */
export async function staffShellProps():Promise<{locale:StaffLocale;shell:{stamp:string;stores:string[];access:ShellAccess;name:string}|null}>{
 const locale=staffLocaleFrom((await cookies()).get(STAFF_LOCALE_COOKIE)?.value);
 const s=await staffState(new Headers(await headers()));
 if(s.status!=='authorized')return {locale,shell:null};
 const p=s.principal,has=(x:string)=>(p.permissions as string[]).includes(x);
 return {locale,shell:{stamp:publicStamp(s.stamp),stores:[...p.storeIds],name:'',access:{bookingView:has('BOOKING_VIEW'),bookingCreate:canCreateStaffOrder(p),inventoryView:has('INVENTORY_VIEW'),operationsView:has('OPERATIONS_VIEW'),manageStaff:canManage(p),transferView:has('TRANSFER_VIEW'),quoteView:has('QUOTE_VIEW'),holdView:has('HOLD_VIEW'),priceEdit:has('PRICE_EDIT'),resend:has('NOTIFICATION_RESEND'),groupView:p.role==='ADMIN'&&has('GROUP_VIEW')}}};
}
