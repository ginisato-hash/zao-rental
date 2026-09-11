import type {LedgerRecord,LedgerDetail,LedgerInput,LedgerFilters,Resource} from '../../../../../packages/contracts/src/ledger';
export type LedgerClient={
 list:(resource:Resource,filters?:LedgerFilters)=>Promise<{items:LedgerRecord[];total:number}>;
 get:(resource:Resource,id:string)=>Promise<LedgerDetail>;
 create:(resource:Resource,input:LedgerInput)=>Promise<LedgerDetail>;
 update:(resource:Resource,id:string,input:LedgerInput)=>Promise<LedgerDetail>;
};
export function createHttpLedgerClient(stamp?:string,onDenied?:()=>void):LedgerClient {
async function call(path:string,method='GET',data?:LedgerInput){
 const response=await fetch('/api/ledger/'+path,{method,cache:'no-store',headers:{'Content-Type':'application/json',...(stamp?{'x-zao-session':stamp}:{})},...(data?{body:JSON.stringify(data)}:{})});
 if([401,403,409].includes(response.status)) {if(response.status!==409)onDenied?.();}
 const body=await response.json();if(body.error==='SESSION_CHANGED')onDenied?.();if(!response.ok)throw new Error(body.error??'LEDGER_OPERATION_FAILED');return body;
}
return {
 list:(resource,filters={})=>call(resource+'?'+new URLSearchParams(Object.entries(filters).filter(([,v])=>v!==undefined).map(([k,v])=>[k,String(v)]))),
 get:(resource,id)=>call(`${resource}/${id}`),create:(resource,data)=>call(resource,'POST',data),update:(resource,id,data)=>call(`${resource}/${id}`,'PATCH',data),
};

}
export const httpLedgerClient=createHttpLedgerClient();
