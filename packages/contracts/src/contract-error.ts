// Contract errors (HoldError, FlowError, LedgerError) carry a process-wide brand. Production composes services in the
// instrumentation bundle while routes map errors in their own bundle, so `instanceof` against a route-local class is
// false for the very same error; the global-symbol brand survives that boundary. Only branded errors with a valid HTTP
// status are mapped as contract errors; anything else (runtime, DB, unexpected) must stay an internal 500.
export const CONTRACT_ERROR=Symbol.for('zao.rental.contract-error');
export type ContractError=Error&{code:string;status:number};
export function brandContractError(e:Error){Object.defineProperty(e,CONTRACT_ERROR,{value:true});}
export function isContractError(e:unknown):e is ContractError{
 if(!(e instanceof Error)||(e as unknown as Record<symbol,unknown>)[CONTRACT_ERROR]!==true)return false;
 const {code,status}=e as Partial<ContractError>;
 return typeof code==='string'&&/^[A-Z][A-Z0-9_]{1,80}$/.test(code)&&Number.isInteger(status)&&status!>=400&&status!<=599;
}
