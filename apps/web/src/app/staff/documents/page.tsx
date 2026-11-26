import {StaffDocuments} from '../../../components/StaffDocuments';
import {staffShellProps} from '../../../lib/staff-shell-props';
import {StaffGate} from '../../../components/StaffGate';
export const dynamic='force-dynamic';
export default async function Page(){
 const {shell}=await staffShellProps();
 if(!shell||!shell.access.bookingView||!shell.stores.length)return <StaffGate title={['予約閲覧権限が必要です','Booking access required']}/>;
 return <StaffDocuments stamp={shell.stamp} stores={shell.stores}/>;
}
