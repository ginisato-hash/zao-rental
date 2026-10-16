const ANSI=/\u001b\[[0-9;?]*[ -\/]*[@-~]/g;
const phases=new Set(['AUTHENTICATION','LIST','INPUT','WRITE']);
const categories=new Set(['OTHER','23505','23503','23514','40001','40P01','53300','57014','08003','08006','57P01']);
/** Test child stderr only. Keep the historical AUTH allowlist; never forward raw JSON/errors. */
export function safeWebDiagnostic(raw:string):string|null{
 // Colour/style escapes (Next dev colours its `⨯` prefix) are normalised away before any pattern is applied.
 const line=raw.replace(ANSI,'');
 if(/^AUTH_PIPELINE_CODE [A-Z0-9_]{1,80}$/.test(line))return line;
 const request=safeRequestErrorLine(line);if(request)return request;
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
 // One streaming decoder: a multi-byte character split across stderr chunks is completed, not replaced.
 let pending='',overflow=false;const decoder=new TextDecoder('utf-8');
 const finish=()=>{if(!overflow){const safe=safeWebDiagnostic(pending);if(safe)emit(safe);}pending='';overflow=false;};
 const feed=(text:string)=>{for(const ch of text){if(ch==='\n'){finish();continue;}if(!overflow){if(pending.length+ch.length>2048){pending='';overflow=true;}else pending+=ch;}}};
 return {push(chunk:Uint8Array|string){feed(typeof chunk==='string'?chunk:decoder.decode(chunk,{stream:true}));},end(){feed(decoder.decode());finish();}};
}

/** Test transport failures: classify known messages but never return their contents. */
export function safeTestTransportFailure(error:unknown){
 let message='';try{const d=Object.getOwnPropertyDescriptor(error,'message');if(d&&'value' in d&&typeof d.value==='string')message=d.value;}catch{}
 const category=/^DISK_BLOCKED /.test(message)?'DISK_SPACE':/^Port \d+ is occupied; refusing to attach or kill any process$/.test(message)?'LOCAL_PORT_UNAVAILABLE':/^Ambient database configuration detected;/.test(message)?'AMBIENT_DATABASE_REJECTED':/ECONNRESET|socket hang up/i.test(message)?'CONNECTION_RESET':/ECONNREFUSED/i.test(message)?'CONNECTION_REFUSED':/ETIMEDOUT|Timeout [0-9]+ms exceeded|timed out/i.test(message)?'TIMEOUT':/Target (page|browser|context).*closed|context.*disposed/i.test(message)?'CONTEXT_CLOSED':'UNCLASSIFIED';
 return {code:'TEST_HTTP_TRANSPORT_FAILURE',category};
}

/** Test-side HTTP response classification before an assertion: status, content-type kind, an allowlisted error code
 * and a fixed framework category. Never returns body text, headers, cookies or request data. */
/** The finite set of machine codes the staff-account route and its readers can return; anything else is UNLISTED. */
export const STAFF_RESPONSE_CODES=new Set(['AUTHENTICATION_REQUIRED','BODY_TOO_LARGE','DUPLICATE_ACCOUNT','FORBIDDEN','INVALID_FILTER','INVALID_INPUT','INVALID_JSON','JSON_REQUIRED',
 'LEDGER_OPERATION_FAILED','METHOD_NOT_ALLOWED','NOT_FOUND','ORIGIN_REJECTED','SELF_ACCESS_CHANGE_FORBIDDEN','SESSION_CHANGED','STAFF_OPERATION_FAILED','STALE_STAFF_REVISION','STORE_SCOPE_REQUIRED']);
export type ResponseDiagnosticStage='STAFF_CREATE';
export async function safeHttpResponseDiagnostic(stage:ResponseDiagnosticStage,response:{status():number;headers():Record<string,string>;text():Promise<string>}){
 if(stage!=='STAFF_CREATE')throw new Error('DIAGNOSTIC_STAGE_REJECTED');
 const type=response.headers()['content-type']??'',kind=/application\/json/.test(type)?'JSON':/text\/html/.test(type)?'HTML':type?'OTHER':'NONE';let body='',unreadable=false;try{body=await response.text();}catch{unreadable=true;}
 let errorCode:string|null=unreadable?'UNREADABLE':null;if(kind==='JSON'&&!unreadable){try{const v=JSON.parse(body) as {error?:unknown};errorCode=typeof v?.error==='string'&&STAFF_RESPONSE_CODES.has(v.error)?v.error:v&&typeof v==='object'&&'error' in v?'UNLISTED':'NO_ERROR_FIELD';}catch{errorCode='UNPARSEABLE_JSON';}}
 const framework=kind!=='HTML'||unreadable?null:/Failed to compile|Module not found|Module build failed/.test(body)?'FRAMEWORK_COMPILE_ERROR':/__next_error__|Internal Server Error|Unhandled Runtime Error/.test(body)?'FRAMEWORK_RUNTIME_ERROR':'HTML_OTHER';
 return {code:'TEST_HTTP_RESPONSE_DIAGNOSTIC',stage,status:response.status(),contentKind:kind,errorCode,framework};
}

/** Fixture-only `onRequestError` classification. Next calls it only for errors that escape a route handler (module
 * evaluation, compilation, uncaught throws); the staff route itself catches everything it can. Inputs are inspected
 * through own data properties only; the emitted record holds nothing but these finite enums. Pattern names are
 * observations, not root causes. */
const REQUEST_SCOPES=new Set(['STAFF_CREATE','FIXTURE_PROBE']),ROUTE_TYPES=new Set(['render','route','action','proxy']);
const ERROR_TYPES=new Set(['Error','TypeError','ReferenceError','SyntaxError','RangeError','AggregateError','ChunkLoadError']);
const REASONS=new Set(['MODULE_NOT_FOUND','CHUNK_LOAD','FS_ENOENT','FS_EMFILE','NET_REFUSED','NET_RESET','TIMEOUT','SQLSTATE','OTHER']);
export function requestErrorScope(method:string,path:string){
 if(method==='POST'&&/^\/api\/staff-users\/?(\?|$)/.test(path))return 'STAFF_CREATE';
 if(/^\/api\/test-diagnostic-probe\/?(\?|$)/.test(path))return 'FIXTURE_PROBE';
 return null;
}
export function requestErrorRecord(error:unknown,request:{path:string;method:string},context:{routeType:string}){
 const scope=requestErrorScope(request.method,request.path);if(!scope)return null;
 const own=(k:string)=>{try{const d=error&&typeof error==='object'?Object.getOwnPropertyDescriptor(error,k):undefined;return d&&'value' in d?d.value:undefined;}catch{return undefined;}};
 let name='OTHER';try{const n=error instanceof Error?error.constructor?.name:undefined;if(typeof n==='string'&&ERROR_TYPES.has(n))name=n;}catch{/* hostile */}
 const code=own('code'),message=own('message'),text=typeof message==='string'?message:'';
 const sqlState=typeof code==='string'&&categories.has(code)&&code!=='OTHER'?code:null;
 const reason=sqlState?'SQLSTATE':code==='MODULE_NOT_FOUND'||/Cannot find module|Module not found/.test(text)?'MODULE_NOT_FOUND':name==='ChunkLoadError'||/Loading chunk .* failed/.test(text)?'CHUNK_LOAD'
  :code==='ENOENT'?'FS_ENOENT':code==='EMFILE'?'FS_EMFILE':code==='ECONNREFUSED'?'NET_REFUSED':code==='ECONNRESET'?'NET_RESET':code==='ETIMEDOUT'||/timeout/i.test(text)?'TIMEOUT':'OTHER';
 return {code:'TEST_REQUEST_ERROR',scope,routeType:ROUTE_TYPES.has(context.routeType)?context.routeType:'OTHER',errorType:name,reason,sqlState};
}
function safeRequestErrorLine(line:string){
 if(!line.startsWith('{"code":"TEST_REQUEST_ERROR"'))return null;
 try{const v=JSON.parse(line);if(!v||typeof v!=='object'||Object.keys(v).sort().join()!=='code,errorType,reason,routeType,scope,sqlState')return null;
  if(!REQUEST_SCOPES.has(v.scope)||!(ROUTE_TYPES.has(v.routeType)||v.routeType==='OTHER')||!(ERROR_TYPES.has(v.errorType)||v.errorType==='OTHER')||!REASONS.has(v.reason)||!(v.sqlState===null||(categories.has(v.sqlState)&&v.sqlState!=='OTHER')))return null;
  return JSON.stringify({code:v.code,scope:v.scope,routeType:v.routeType,errorType:v.errorType,reason:v.reason,sqlState:v.sqlState});}catch{return null;}
}
