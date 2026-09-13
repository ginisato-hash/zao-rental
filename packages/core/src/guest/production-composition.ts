import type {Pool} from 'pg';
import {approvedGuestConfiguration,guestConfigurationHash} from '../../../contracts/src/production-guest';
import {GuestContexts} from './context';
import {GuestSecurity} from './security';
import {trustedGuestPeer,type TrustedIngressAdapter} from './trusted-ingress';
export type GuestStartupAudit={event:'GUEST_SECURITY_CONFIGURED';revision:string;policyVersion:string;configurationSha256:string;ingressAdapterId:string};
/** Injectable production-ready composition boundary; NOT connected to the normal runtime.
 * No env secrets/default policy/provider are loaded here. Audit failure aborts startup.
 * All replicas need identical configuration/key and the same DB. */
export async function composeProductionGuestSecurity(args:{pool:Pool;configuration:unknown;approvedConfigurationSha256:string|undefined;serverKey:string;ingress:TrustedIngressAdapter;audit:(event:GuestStartupAudit)=>Promise<void>}){
 const c=approvedGuestConfiguration(args.configuration,args.approvedConfigurationSha256);
 const peer=trustedGuestPeer(args.ingress,c.ingressAdapterId,args.serverKey),contexts=new GuestContexts(args.pool),service=new GuestSecurity(args.pool,contexts,c.policy,args.serverKey);
 // Verifies/registers immutable policy in PostgreSQL before accepting any request.
 await service.transaction(async()=>{});
 await args.audit({event:'GUEST_SECURITY_CONFIGURED',revision:c.revision,policyVersion:c.policy.version,configurationSha256:guestConfigurationHash(c),ingressAdapterId:c.ingressAdapterId});
 return Object.freeze({contexts,security:Object.freeze({service,peer}),configuration:c});
}
