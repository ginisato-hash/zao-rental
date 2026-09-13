const phases=new Set(['AUTHENTICATION','LIST','INPUT','WRITE']);
const categories=new Set(['OTHER','23505','23503','23514','40001','40P01','53300','57014','08003','08006','57P01']);
/** Test child stderr only. Keep the historical AUTH allowlist; never forward raw JSON/errors. */
export function safeWebDiagnostic(line:string):string|null{
 if(/^AUTH_PIPELINE_CODE [A-Z0-9_]{1,80}$/.test(line))return line;
 try{
  const v=JSON.parse(line);if(!v||typeof v!=='object'||Object.keys(v).sort().join()!=='category,code,correlationId,phase'||v.code!=='STAFF_OPERATION_DIAGNOSTIC'||typeof v.correlationId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v.correlationId)||!phases.has(v.phase)||!categories.has(v.category))return null;
  return JSON.stringify({code:v.code,correlationId:v.correlationId,phase:v.phase,category:v.category});
 }catch{return null;}
}
/** Handles chunk boundaries and drops an entire oversized line, including its valid-looking suffix. */
export function webDiagnosticForwarder(emit:(line:string)=>void){
 let pending='',overflow=false;
 const finish=()=>{if(!overflow){const safe=safeWebDiagnostic(pending);if(safe)emit(safe);}pending='';overflow=false;};
 return {push(chunk:Uint8Array|string){for(const ch of (typeof chunk==='string'?chunk:Buffer.from(chunk).toString('utf8'))){if(ch==='\n'){finish();continue;}if(!overflow){if(pending.length+ch.length>2048){pending='';overflow=true;}else pending+=ch;}}},end(){finish();}};
}
