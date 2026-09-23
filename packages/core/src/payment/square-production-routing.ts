import {FlowError,type PaymentGateway,type PaymentRequest} from '../../../contracts/src/rental-flow';
import type {StoreId} from '../../../contracts/src/ledger';
import type {RefundRequest} from '../operations/financial';
import {SquareProductionGateway,type SquareProductionTransport} from './square-production';
import {SquareRefundGateway,type CancellationRefundGateway} from './square-refund';

/** A Production transport that is bound to exactly one Square location (FetchSquareProductionTransport). */
export type LocationBoundProductionTransport=SquareProductionTransport&{readonly locationId:string};
export type ProductionStoreRoutes=Readonly<Record<StoreId,{locationId:string;transport:LocationBoundProductionTransport}>>;
const STORES:readonly StoreId[]=['MOUNTAIN_BASE','ONSEN_BASE'];

/** Two strict single-location transports, never one transport that accepts either location.
 * The location comes only from the durable attempt/refund row (derived server-side from the
 * booking's pickupStore); there is no fallback, default or "first configured" route. */
function locationRoutes<T>(merchantId:string,routes:ProductionStoreRoutes,build:(t:LocationBoundProductionTransport)=>T){
 if(!/^[A-Za-z0-9_-]{1,100}$/.test(merchantId)||!routes||Object.keys(routes).sort().join()!==[...STORES].sort().join())throw new FlowError('SQUARE_CONFIGURATION_INVALID',503);
 const byLocation=new Map<string,T>();
 for(const store of STORES){const {locationId,transport}=routes[store];
  if(!/^[A-Za-z0-9_-]{1,100}$/.test(locationId)||transport?.environment!=='PRODUCTION'||transport.merchantId!==merchantId||transport.locationId!==locationId||byLocation.has(locationId))throw new FlowError('SQUARE_CONFIGURATION_INVALID',503);
  byLocation.set(locationId,build(transport));
 }
 return byLocation;
}

export class RoutedSquareProductionGateway implements PaymentGateway{
 readonly kind='SQUARE_PRODUCTION' as const;
 private readonly byLocation:Map<string,SquareProductionGateway>;
 constructor(private readonly merchantId:string,routes:ProductionStoreRoutes,timeoutMs=5000){
  // The browser card token is passed per call and never stored; no stored/default source exists.
  this.byLocation=locationRoutes(merchantId,routes,t=>new SquareProductionGateway(t,async()=>{throw new FlowError('PAYMENT_SOURCE_NOT_CONNECTED',503);},timeoutMs));
 }
 private route(r:PaymentRequest){
  if(r.merchantId!==this.merchantId)throw new FlowError('PAYMENT_EVIDENCE_MISMATCH');
  const gateway=this.byLocation.get(r.locationId);if(!gateway)throw new FlowError('PAYMENT_LOCATION_UNROUTED',503);return gateway;
 }
 async create(r:PaymentRequest,sourceToken?:string){return this.route(r).create(r,sourceToken);}
 async lookup(r:PaymentRequest,providerId:string|null){return this.route(r).lookup(r,providerId);}
}

export class RoutedSquareProductionRefundGateway implements CancellationRefundGateway{
 readonly kind='SQUARE_PRODUCTION' as const;
 private readonly byLocation:Map<string,SquareRefundGateway>;
 constructor(private readonly merchantId:string,routes:ProductionStoreRoutes,timeoutMs=5000){
  this.byLocation=locationRoutes(merchantId,routes,t=>new SquareRefundGateway(t,timeoutMs));
 }
 private route(r:RefundRequest){
  if(r.merchantId!==this.merchantId)throw new FlowError('REFUND_EVIDENCE_MISMATCH');
  const gateway=this.byLocation.get(r.locationId);if(!gateway)throw new FlowError('REFUND_LOCATION_UNROUTED',503);return gateway;
 }
 async create(r:RefundRequest){return this.route(r).create(r);}
 async lookup(r:RefundRequest,providerId:string|null){return this.route(r).lookup(r,providerId);}
}
