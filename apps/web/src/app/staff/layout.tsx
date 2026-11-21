import type {ReactNode} from 'react';
import {StaffShell} from '../../components/StaffShell';
import {staffShellProps} from '../../lib/staff-shell-props';
export const dynamic='force-dynamic';
/** /staff and /admin share one working shell (Issue #47 §2A). Signed-out pages render without it. */
export default async function StaffLayout({children}:{children:ReactNode}){
 const {locale,shell}=await staffShellProps();
 if(!shell)return children;
 return <StaffShell locale={locale} {...shell}>{children}</StaffShell>;
}
