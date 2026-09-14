import {sandboxAcceptanceEnvironment, sandboxEnvironmentNames} from '../../../../packages/core/src/payment/sandbox-environment';
import {SQUARE_VERSION} from '../../../../packages/core/src/payment/square-sandbox';

type Environment = Readonly<Record<string, string | undefined>>;
export type S1PreflightReason = 'DEPLOYMENT_NOT_PREVIEW' | 'NOT_SANDBOX' | 'API_VERSION_MISMATCH' |
 'APPLICATION_ID_INVALID' | 'LOCATION_ID_INVALID' | 'CREDENTIAL_MISSING' | 'CREDENTIAL_FORMAT_INVALID' |
 'PUBLIC_CREDENTIAL_EXPOSURE' | 'CONFIGURATION_INVALID';
export type S1Preflight = {
 environment:'SANDBOX'|null; deployment:'preview'|null; apiVersionMatch:boolean;
 applicationIdConfigured:boolean; locationIdConfigured:boolean; accessTokenConfigured:boolean;
 accessTokenFormatValid:boolean; publicCredentialExposure:boolean; readyForS1:boolean;
 result:'PASS'|'BLOCKED'; reason:S1PreflightReason|null;
};

/** Pure runtime inspection: no network port, ambient fetch, logging or value output.
 * Unrelated public configuration is allowed; public Square keys or reflected secrets
 * are rejected before projecting the private S1 metadata into the existing parser. */
export function squareS1Preflight(env:Environment):S1Preflight {
 const result:S1Preflight={environment:null,deployment:null,apiVersionMatch:false,
  applicationIdConfigured:false,locationIdConfigured:false,accessTokenConfigured:false,
  accessTokenFormatValid:false,publicCredentialExposure:false,readyForS1:false,result:'BLOCKED',reason:null};
 const block=(reason:S1PreflightReason)=>{result.reason=reason;return result;};
 try {
  const identifier=(value:string|undefined)=>!!value&&/^[A-Za-z0-9_-]{1,100}$/.test(value);
  const token=env.SQUARE_SANDBOX_ACCESS_TOKEN;
  const webhookKey=env.SQUARE_SANDBOX_WEBHOOK_SIGNATURE_KEY;
  result.environment=env.SQUARE_ENVIRONMENT==='SANDBOX'?'SANDBOX':null;
  result.deployment=env.VERCEL_ENV==='preview'?'preview':null;
  result.apiVersionMatch=env.SQUARE_API_VERSION===SQUARE_VERSION;
  result.applicationIdConfigured=identifier(env.SQUARE_SANDBOX_APPLICATION_ID);
  result.locationIdConfigured=identifier(env.SQUARE_SANDBOX_LOCATION_ID);
  result.accessTokenConfigured=!!token;
  result.accessTokenFormatValid=!!token&&/^[-A-Za-z0-9._~+/=]{1,4096}$/.test(token);
  result.publicCredentialExposure=Object.keys(env).some(key=>{
   if(!/^NEXT_PUBLIC_/i.test(key))return false;
   const value=env[key];
   return !!value&&(/SQUARE/i.test(key)||[token,webhookKey].some(secret=>!!secret&&value.includes(secret)));
  });
  if(!result.deployment)return block('DEPLOYMENT_NOT_PREVIEW');
  if(!result.environment)return block('NOT_SANDBOX');
  if(result.publicCredentialExposure)return block('PUBLIC_CREDENTIAL_EXPOSURE');
  if(!result.apiVersionMatch)return block('API_VERSION_MISMATCH');
  if(!result.applicationIdConfigured)return block('APPLICATION_ID_INVALID');
  if(!result.locationIdConfigured)return block('LOCATION_ID_INVALID');
  if(!result.accessTokenConfigured)return block('CREDENTIAL_MISSING');
  if(!result.accessTokenFormatValid)return block('CREDENTIAL_FORMAT_INVALID');
  const metadata:Record<string,string|undefined>={VERCEL_ENV:env.VERCEL_ENV};
  for(const name of ['environment','apiVersion','applicationId','locationId','merchantId','notificationUrl'] as const)
   metadata[sandboxEnvironmentNames[name]]=env[sandboxEnvironmentNames[name]];
  sandboxAcceptanceEnvironment(metadata);
  result.readyForS1=true;result.result='PASS';return result;
 }catch{return block('CONFIGURATION_INVALID');}
}
