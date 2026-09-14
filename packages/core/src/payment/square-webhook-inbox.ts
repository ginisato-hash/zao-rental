import type {SquareWebhook} from './square-boundary';

export type WebhookEnvironment = 'SANDBOX' | 'PRODUCTION';
export type InboxSignal = SquareWebhook & {environment:WebhookEnvironment;bodySha256:string};
export type Receipt = 'INSERTED' | 'DUPLICATE' | 'HASH_CONFLICT';
/** receive resolves only after COMMIT (including conflict bookkeeping). No provider/booking capability. */
export interface SquareWebhookInbox {receive(signal:InboxSignal):Promise<Receipt>}
export type InboxClaim = InboxSignal & {claimToken:string;attempt:number;leaseUntil:Date};
export type ReconcileResult =
 | {state:'RECONCILED'}
 | {state:'FAILED_RETRYABLE';reason:'PROVIDER_UNAVAILABLE';retrySeconds:number}
 | {state:'BLOCKED';reason:'IDENTITY_MISMATCH'|'UNSUPPORTED_PAYMENT'|'MANUAL_REVIEW'};
/** Not a worker: caller must separately verify latest provider state. Lease token fences stale completion. */
export interface SquareWebhookReconciliation {
 claim(environment:WebhookEnvironment,leaseSeconds:number):Promise<InboxClaim|null>;
 settle(claim:InboxClaim,result:ReconcileResult):Promise<boolean>;
}
