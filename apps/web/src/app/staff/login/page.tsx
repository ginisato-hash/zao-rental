import {cookies} from 'next/headers';
import {StaffLogin} from '../../../components/StaffLogin';
import {logo} from '../../../components/brand/media';
import '../../../components/staff-login.css';
import {getRuntime} from '../../../lib/staff-runtime';
import {STAFF_LOCALE_COOKIE,staffLocaleFrom} from '../../../components/staff-i18n';
export const dynamic='force-dynamic';
export default async function Page(){const locale=staffLocaleFrom((await cookies()).get(STAFF_LOCALE_COOKIE)?.value);
 return <main className="staff-account staff-login-page">
{/* eslint-disable-next-line @next/next/no-img-element -- fixed-size official logo raster, as in PublicChrome */}
<img className="staff-login-logo" src={logo.src} width={logo.width} height={logo.height} alt="SALOMON RENTAL STATION ZAO"/><StaffLogin configured={Boolean(getRuntime()?.auth)} initialLocale={locale}/></main>;}
