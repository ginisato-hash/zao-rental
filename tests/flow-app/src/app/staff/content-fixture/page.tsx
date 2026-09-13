import {headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {staffState,publicStamp} from '../../../../../../apps/web/src/lib/staff-runtime';
import {ContentFixtureWorkspace} from '../../../../../content/Workspace';
export const dynamic='force-dynamic';
export default async function Page(){const s=await staffState(await headers());if(s.status!=='authorized')redirect('/staff/login');return <ContentFixtureWorkspace stamp={publicStamp(s.stamp)}/>;}
