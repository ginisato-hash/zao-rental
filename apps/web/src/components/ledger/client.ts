import type {LedgerRecord,LedgerDetail,LedgerInput,LedgerFilters,Resource} from '../../../../../packages/contracts/src/ledger';
export type LedgerClient={
 list:(resource:Resource,filters?:LedgerFilters)=>Promise<{items:LedgerRecord[];total:number}>;
 get:(resource:Resource,id:string)=>Promise<LedgerDetail>;
 create:(resource:Resource,input:LedgerInput)=>Promise<LedgerDetail>;
 update:(resource:Resource,id:string,input:LedgerInput)=>Promise<LedgerDetail>;
};
async function call(path:string,method='GET',data?:LedgerInput){
 const response=await fetch('/api/ledger/'+path,{method,cache:'no-store',headers:{'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});
 const body=await response.json();if(!response.ok)throw new Error(body.error??'LEDGER_OPERATION_FAILED');return body;
}
export const httpLedgerClient:LedgerClient={
 list:(resource,filters={})=>call(resource+'?'+new URLSearchParams(Object.entries(filters).filter(([,v])=>v!==undefined).map(([k,v])=>[k,String(v)]))),
 get:(resource,id)=>call(`${resource}/${id}`),create:(resource,data)=>call(resource,'POST',data),update:(resource,id,data)=>call(`${resource}/${id}`,'PATCH',data),
};
