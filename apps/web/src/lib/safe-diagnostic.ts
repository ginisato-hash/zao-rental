// Privacy-safe server diagnostic for an unexpected 500: only the route label, the error class, the PostgreSQL SQLSTATE (5 chars), the
// schema object names PostgreSQL reports, and a fixed UPPER_SNAKE error code when the error carries one. The free-text error message is
// NEVER logged (it can embed names, e-mail, QR text or SQL values). No request body, header, cookie, customer value or query result is
// ever logged. This exists because a generic 500 JSON otherwise leaves the Vercel function log empty (custody returned 500 for every
// production booking with no way to see why).
const SQLSTATE=/^[0-9A-Z]{5}$/;
export function safeDiagnostic(route:string,error:unknown){
 const e=error as {name?:unknown;code?:unknown;message?:unknown;table?:unknown;column?:unknown;routine?:unknown}|null;
 const pg=typeof e?.code==='string'&&SQLSTATE.test(e.code)?e.code:undefined;
 const code=(v:unknown)=>typeof v==='string'&&/^[A-Z][A-Z0-9]*_[A-Z0-9_]{1,78}$/.test(v)?v:undefined;
 const word=(v:unknown)=>typeof v==='string'&&/^[A-Za-z0-9_.]{1,80}$/.test(v)?v:undefined;
 return {route:/^[a-z-]{1,40}$/.test(route)?route:'unknown',errorName:word(e?.name)??'Error',pgCode:pg,table:word(e?.table),column:word(e?.column),routine:word(e?.routine),errorCode:code(e?.code)??code(e?.message)};
}
export function logUnexpected(route:string,error:unknown){try{console.error('UNEXPECTED_'+route.toUpperCase().replace(/-/g,'_'),JSON.stringify(safeDiagnostic(route,error)));}catch{/* diagnostics must never change the response */}}
