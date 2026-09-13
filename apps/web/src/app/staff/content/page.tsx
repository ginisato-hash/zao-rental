import {headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {staffState,publicStamp} from '../../../lib/staff-runtime';
import {ContentWorkspace} from '../../../components/ContentWorkspace';
export const dynamic='force-dynamic';
export default async function Page(){const s=await staffState(await headers());if(s.status!=='authorized')redirect('/staff/login');return <ContentWorkspace stamp={publicStamp(s.stamp)}/>;}
