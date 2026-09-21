import policy from '../../../../config/production/guest.p4-approved-policy.json';
import {GuestSecurity} from '../guest/security';
import type {GuestContexts} from '../guest/context';
import type {Pool} from 'pg';
/** Existing business policy is unchanged. The version prefix isolates image fan-out
 * on the same atomic PostgreSQL buckets; no new external service/table. */
export const avatarGuestPolicy=Object.freeze({...policy.policy,version:'avatar-phase6-v1',peerRequests:240,globalRequests:1200});
export function avatarGuestSecurity(pool:Pool,contexts:GuestContexts,key:string){return new GuestSecurity(pool,contexts,avatarGuestPolicy,key);}
