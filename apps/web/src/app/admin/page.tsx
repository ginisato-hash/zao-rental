import {redirect} from 'next/navigation';
export const dynamic = 'force-dynamic';
/** /admin and /staff are one working shell (Issue #47 §2A); the former placeholder page now opens the dashboard. */
export default function Page() { redirect('/staff'); }
