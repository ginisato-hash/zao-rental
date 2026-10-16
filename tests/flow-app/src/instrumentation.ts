// Test fixture only (never deployed): report errors that escape a route handler as a fixed-enum record on stderr,
// which the launcher's allowlist forwards. No request, headers, context or exception value is serialised.
import type {Instrumentation} from 'next';
import {requestErrorRecord} from '../../flow/web-diagnostics';
export const onRequestError:Instrumentation.onRequestError=(error,request,context)=>{
 const record=requestErrorRecord(error,{path:request.path,method:request.method},{routeType:context.routeType});
 if(record)console.error(JSON.stringify(record));
};
