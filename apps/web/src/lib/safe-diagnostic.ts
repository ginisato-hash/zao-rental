// Privacy-safe server diagnostic for an unexpected 500: only the route label, the error class, the PostgreSQL SQLSTATE (5 chars) and a
// message with every identifier, address and long number removed. No request body, header, cookie, customer value or query result is ever
// logged. This exists because a generic 500 JSON otherwise leaves the Vercel function log empty (custody returned 500 for every
// production booking with no way to see why).
const SQLSTATE=/^[0-9A-Z]{5}$/;
export function redactDiagnosticMessage(value:unknown):string{
 const text=typeof value==='string'?value:'';
 return text
  .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,'<id>')
  .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,'<mail>')
  .replace(/\b[0-9a-f]{16,}\b/gi,'<hex>')
  .replace(/\d{6,}/g,'<n>')
  .replace(/\s+/g,' ')
  .slice(0,200);
}
export function safeDiagnostic(route:string,error:unknown){
 const e=error as {name?:unknown;code?:unknown;message?:unknown;table?:unknown;column?:unknown;routine?:unknown}|null;
 const pg=typeof e?.code==='string'&&SQLSTATE.test(e.code)?e.code:undefined;
 const word=(v:unknown)=>typeof v==='string'&&/^[A-Za-z0-9_.]{1,80}$/.test(v)?v:undefined;
 return {route:/^[a-z-]{1,40}$/.test(route)?route:'unknown',errorName:word(e?.name)??'Error',pgCode:pg,table:word(e?.table),column:word(e?.column),routine:word(e?.routine),message:redactDiagnosticMessage(e?.message)};
}
export function logUnexpected(route:string,error:unknown){try{console.error('UNEXPECTED_'+route.toUpperCase().replace(/-/g,'_'),JSON.stringify(safeDiagnostic(route,error)));}catch{/* diagnostics must never change the response */}}
