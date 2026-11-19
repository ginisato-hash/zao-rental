import {cookies} from 'next/headers';
import {StaffLogin} from '../../../components/StaffLogin';
import {getRuntime} from '../../../lib/staff-runtime';
import {STAFF_LOCALE_COOKIE,staffLocaleFrom} from '../../../components/staff-i18n';
export const dynamic='force-dynamic';
export default async function Page(){const locale=staffLocaleFrom((await cookies()).get(STAFF_LOCALE_COOKIE)?.value);
 return <main className="staff-account"><p>SALOMON RENTAL STATION ZAO · STAFF</p><StaffLogin configured={Boolean(getRuntime()?.auth)} initialLocale={locale}/></main>;}
