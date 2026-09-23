import {FlowError} from '../../../contracts/src/rental-flow';
import {SquarePaymentGateway,type SquareTransport} from './square-engine';
export {SQUARE_PRODUCTION_ORIGIN} from './square-engine';
export interface SquareProductionTransport extends SquareTransport {readonly environment:'PRODUCTION';}
export class SquareProductionGateway extends SquarePaymentGateway {
 readonly kind='SQUARE_PRODUCTION' as const;
 constructor(transport:SquareProductionTransport,source:(attemptId:string,signal:AbortSignal)=>Promise<string>,timeoutMs=5000){
  if(transport.environment!=='PRODUCTION')throw new FlowError('SQUARE_CONFIGURATION_INVALID',503);
  super(transport,source,timeoutMs);
 }
}
