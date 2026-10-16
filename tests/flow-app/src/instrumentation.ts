// Test fixture only (never deployed): report errors Next captures and passes to this hook as fixed enums on stderr.
// The probe verifies one synthetic route throw; it does not prove all compile/module/startup errors reach the hook.
// The launcher forwards only allowlisted records. No request, headers, context or exception value is serialised.
import type {Instrumentation} from 'next';
import {requestErrorRecord} from '../../flow/web-diagnostics';
export const onRequestError:Instrumentation.onRequestError=(error,request,context)=>{
 const record=requestErrorRecord(error,{path:request.path,method:request.method},{routeType:context.routeType});
 if(record)console.error(JSON.stringify(record));
};
