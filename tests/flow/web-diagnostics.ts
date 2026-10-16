const phases=new Set(['AUTHENTICATION','LIST','INPUT','WRITE']);
const categories=new Set(['OTHER','23505','23503','23514','40001','40P01','53300','57014','08003','08006','57P01']);
/** Test child stderr only. Keep the historical AUTH allowlist; never forward raw JSON/errors. */
export function safeWebDiagnostic(line:string):string|null{
 if(/^AUTH_PIPELINE_CODE [A-Z0-9_]{1,80}$/.test(line))return line;
 // Next dev server failures (compile / module / unhandled) as a fixed category only: the line text is never forwarded.
 const next=nextDevErrorCategory(line);if(next)return 'NEXT_DEV_ERROR '+next;
 try{
  const v=JSON.parse(line);if(!v||typeof v!=='object'||Object.keys(v).sort().join()!=='category,code,correlationId,phase'||v.code!=='STAFF_OPERATION_DIAGNOSTIC'||typeof v.correlationId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v.correlationId)||!phases.has(v.phase)||!categories.has(v.category))return null;
  return JSON.stringify({code:v.code,correlationId:v.correlationId,phase:v.phase,category:v.category});
 }catch{return null;}
}
function nextDevErrorCategory(line:string){
 const t=line.trimStart();if(!/^(⨯|Failed to compile|Module not found|Module build failed)/.test(t))return null;
 return /Failed to compile|Module build failed/.test(t)?'COMPILE':/Module not found|Cannot find module/.test(t)?'MODULE_NOT_FOUND':/unhandledRejection|uncaughtException/.test(t)?'UNHANDLED':'RUNTIME';
}
/** Handles chunk boundaries and drops an entire oversized line, including its valid-looking suffix. */
export function webDiagnosticForwarder(emit:(line:string)=>void){
 let pending='',overflow=false;
 const finish=()=>{if(!overflow){const safe=safeWebDiagnostic(pending);if(safe)emit(safe);}pending='';overflow=false;};
 return {push(chunk:Uint8Array|string){for(const ch of (typeof chunk==='string'?chunk:Buffer.from(chunk).toString('utf8'))){if(ch==='\n'){finish();continue;}if(!overflow){if(pending.length+ch.length>2048){pending='';overflow=true;}else pending+=ch;}}},end(){finish();}};
}

/** Test transport failures: classify known messages but never return their contents. */
export function safeTestTransportFailure(error:unknown){
 let message='';try{const d=Object.getOwnPropertyDescriptor(error,'message');if(d&&'value' in d&&typeof d.value==='string')message=d.value;}catch{}
 const category=/^DISK_BLOCKED /.test(message)?'DISK_SPACE':/^Port \d+ is occupied; refusing to attach or kill any process$/.test(message)?'LOCAL_PORT_UNAVAILABLE':/^Ambient database configuration detected;/.test(message)?'AMBIENT_DATABASE_REJECTED':/ECONNRESET|socket hang up/i.test(message)?'CONNECTION_RESET':/ECONNREFUSED/i.test(message)?'CONNECTION_REFUSED':/ETIMEDOUT|Timeout [0-9]+ms exceeded|timed out/i.test(message)?'TIMEOUT':/Target (page|browser|context).*closed|context.*disposed/i.test(message)?'CONTEXT_CLOSED':'UNCLASSIFIED';
 return {code:'TEST_HTTP_TRANSPORT_FAILURE',category};
}

/** Test-side HTTP response classification before an assertion: status, content-type kind, an allowlisted error code
 * and a fixed framework category. Never returns body text, headers, cookies or request data. */
export async function safeHttpResponseDiagnostic(stage:string,response:{status():number;headers():Record<string,string>;text():Promise<string>}){
 const type=response.headers()['content-type']??'',kind=/application\/json/.test(type)?'JSON':/text\/html/.test(type)?'HTML':type?'OTHER':'NONE';let body='';try{body=await response.text();}catch{}
 let errorCode:string|null=null;if(kind==='JSON'){try{const v=JSON.parse(body) as {error?:unknown};if(typeof v?.error==='string'&&/^[A-Z][A-Z0-9_]{1,80}$/.test(v.error))errorCode=v.error;}catch{errorCode='UNPARSEABLE_JSON';}}
 const framework=kind!=='HTML'?null:/Failed to compile|Module not found|Module build failed/.test(body)?'FRAMEWORK_COMPILE_ERROR':/__next_error__|Internal Server Error|Unhandled Runtime Error/.test(body)?'FRAMEWORK_RUNTIME_ERROR':'HTML_OTHER';
 return {code:'TEST_HTTP_RESPONSE_DIAGNOSTIC',stage,status:response.status(),contentKind:kind,errorCode,framework};
}
