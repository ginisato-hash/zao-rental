import {FlowError} from '../../../contracts/src/rental-flow';
import {SquarePaymentGateway,type SquareTransport} from './square-engine';
export {SQUARE_VERSION,SQUARE_SANDBOX_ORIGIN,type SquareCall,type SandboxRefundBody} from './square-engine';
export interface SquareSandboxTransport extends SquareTransport {readonly environment:'SANDBOX';}
export class SquareSandboxGateway extends SquarePaymentGateway {
 readonly kind='SQUARE_UNCONNECTED' as const;
 constructor(transport:SquareSandboxTransport,source:(attemptId:string,signal:AbortSignal)=>Promise<string>,timeoutMs=5000){
  if(transport.environment!=='SANDBOX')throw new FlowError('SQUARE_CONFIGURATION_INVALID',503);
  super(transport,source,timeoutMs);
 }
}
