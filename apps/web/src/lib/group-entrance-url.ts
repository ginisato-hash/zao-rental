import type {StaffLocale} from '../components/staff-i18n';
/** The one place that spells the customer-facing entrance URL shown to an administrator right after issuing/reissuing it.
 * The customer entrance route (/{ja|en}/group, owned by the customer-flow work) must accept exactly this form. The token is
 * only ever held in memory by the admin screen (never stored, logged or put in a query string). */
export const groupEntranceUrl=(origin:string,locale:StaffLocale,token:string)=>`${origin}/${locale==='en'?'en':'ja'}/group/${encodeURIComponent(token)}`;
