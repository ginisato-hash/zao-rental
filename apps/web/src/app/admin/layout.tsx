import type {ReactNode} from 'react';
import {StaffShell} from '../../components/StaffShell';
import {staffShellProps} from '../../lib/staff-shell-props';
export const dynamic='force-dynamic';
export default async function AdminLayout({children}:{children:ReactNode}){
 const {locale,shell}=await staffShellProps();
 if(!shell)return children;
 return <StaffShell locale={locale} {...shell}>{children}</StaffShell>;
}
