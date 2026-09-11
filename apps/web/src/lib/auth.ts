import 'server-only';
import {headers} from 'next/headers';
import {staffState} from './staff-runtime';
export async function getPrincipal(){return (await staffState(new Headers(await headers()))).principal;}
