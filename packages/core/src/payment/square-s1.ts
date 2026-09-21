import {FlowError} from '../../../contracts/src/rental-flow';
import {SQUARE_VERSION,SQUARE_SANDBOX_ORIGIN} from './square-sandbox';
import {FetchSquareS1Transport,SquareS1TransportError} from './square-transport';

type ObjectValue=Record<string,unknown>;
const object=(value:unknown):ObjectValue=>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();return value as ObjectValue;};
const identity=(value:unknown)=>{if(typeof value!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(value))throw new Error();return value;};
const code=(value:unknown,length:number)=>{if(typeof value!=='string'||!new RegExp('^[A-Z]{'+length+'}$').test(value))throw new Error();return value;};
const activeStatus=(value:unknown)=>{if(value!=='ACTIVE'&&value!=='INACTIVE')throw new Error();return value;};
export type S1Reason='AUTH_FAILED'|'SANDBOX_COUNTRY_MISMATCH'|'CURRENCY_MISMATCH'|'LOCATION_NOT_FOUND'|'LOCATION_ID_MISMATCH'|'MERCHANT_MISMATCH'|'MERCHANT_INACTIVE'|'LOCATION_INACTIVE'|'CAPABILITY_MISSING'|'NETWORK_FAILURE'|'SCHEMA_MISMATCH'|'RATE_LIMITED'|'PROVIDER_FAILURE'|'UNKNOWN';
export type S1Summary={
 environment:'SANDBOX';apiVersion:typeof SQUARE_VERSION;merchantId:string|null;merchantStatus:string|null;merchantCountry:string|null;merchantCurrency:string|null;
 mainLocationMatch:boolean|null;locationCount:number|null;configuredLocationMatch:boolean|null;locationStatus:string|null;locationCountry:string|null;locationCurrency:string|null;
 merchantMatch:boolean|null;cardProcessingCapability:boolean|null;requestCount:number;httpResults:{merchant:number|null;locations:number|null};result:'S1_PASS'|'S1_WARNING'|'S1_FAIL';reason:S1Reason|null;
};
/** Single finite attempt. Call count is conservative when dispatch outcome is unknown.
 * No ambient fetch, DB, retries, payment adapter, logging or raw response export. */
export class SquareS1Service {
 private started=false;
 constructor(private locationId:string,private transport:FetchSquareS1Transport,private timeoutMs=5000){
  identity(locationId);if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>10000)throw new Error('S1_CONFIGURATION_INVALID');
 }
 async run():Promise<S1Summary>{
  if(this.started)throw new FlowError('S1_ALREADY_ATTEMPTED',409);this.started=true;
  const summary:S1Summary={environment:'SANDBOX',apiVersion:SQUARE_VERSION,merchantId:null,merchantStatus:null,merchantCountry:null,merchantCurrency:null,mainLocationMatch:null,locationCount:null,configuredLocationMatch:null,locationStatus:null,locationCountry:null,locationCurrency:null,merchantMatch:null,cardProcessingCapability:null,requestCount:0,httpResults:{merchant:null,locations:null},result:'S1_FAIL',reason:null};
  const fail=(reason:S1Reason)=>{summary.reason=reason;return summary;};
  const read=async(part:'merchant'|'locations',path:string)=>{
   const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),this.timeoutMs);
   summary.requestCount++;
   try{
    const response=await this.transport.send({method:'GET',url:SQUARE_SANDBOX_ORIGIN+path,version:SQUARE_VERSION,signal:controller.signal});
    summary.httpResults[part]=response.status;
    if(response.status===401||response.status===403)throw new FlowError('AUTH_FAILED');
    if(response.status===429)throw new FlowError('RATE_LIMITED');
    if(response.status<200||response.status>=300)throw new FlowError('PROVIDER_FAILURE');
    const body=object(response.body);if(body.errors!==undefined&&(!Array.isArray(body.errors)||body.errors.length))throw new Error();
    return body;
   }catch(e){if(e instanceof SquareS1TransportError)summary.httpResults[part]=e.httpStatus;throw e;}finally{clearTimeout(timer);}
  };
  try{
   const merchant=object((await read('merchant','/v2/merchants/me')).merchant);
   summary.merchantId=identity(merchant.id);summary.merchantStatus=activeStatus(merchant.status);summary.merchantCountry=code(merchant.country,2);summary.merchantCurrency=code(merchant.currency,3);
   summary.mainLocationMatch=identity(merchant.main_location_id)===this.locationId;
   if(summary.merchantStatus!=='ACTIVE')return fail('MERCHANT_INACTIVE');
   if(summary.merchantCountry!=='JP')return fail('SANDBOX_COUNTRY_MISMATCH');
   if(summary.merchantCurrency!=='JPY')return fail('CURRENCY_MISMATCH');
   if(!summary.mainLocationMatch)return fail('LOCATION_ID_MISMATCH');
   const locations=(await read('locations','/v2/locations')).locations;
   if(!Array.isArray(locations))throw new Error();summary.locationCount=locations.length;
   const matches=locations.map(object).filter(location=>identity(location.id)===this.locationId);
   summary.configuredLocationMatch=matches.length===1;
   if(!matches.length)return fail(locations.length?'LOCATION_ID_MISMATCH':'LOCATION_NOT_FOUND');
   if(matches.length!==1)throw new Error();
   const location=matches[0]!;
   summary.locationStatus=activeStatus(location.status);summary.locationCountry=code(location.country,2);summary.locationCurrency=code(location.currency,3);summary.merchantMatch=identity(location.merchant_id)===summary.merchantId;
   if(summary.locationStatus!=='ACTIVE')return fail('LOCATION_INACTIVE');
   if(summary.locationCountry!=='JP')return fail('SANDBOX_COUNTRY_MISMATCH');
   if(summary.locationCurrency!=='JPY')return fail('CURRENCY_MISMATCH');
   if(!summary.merchantMatch)return fail('MERCHANT_MISMATCH');
   if(location.capabilities!==undefined&&(!Array.isArray(location.capabilities)||!location.capabilities.every(v=>typeof v==='string')))throw new Error();
   summary.cardProcessingCapability=Array.isArray(location.capabilities)&&location.capabilities.includes('CREDIT_CARD_PROCESSING');
   if(!summary.cardProcessingCapability){summary.result='S1_WARNING';return fail('CAPABILITY_MISSING');}
   summary.result='S1_PASS';return summary;
  }catch(e){
   if(e instanceof FlowError){
    const map:Record<string,S1Reason>={AUTH_FAILED:'AUTH_FAILED',SQUARE_AUTH_STOP:'AUTH_FAILED',RATE_LIMITED:'RATE_LIMITED',PROVIDER_FAILURE:'PROVIDER_FAILURE',S1_NETWORK_FAILURE:'NETWORK_FAILURE',S1_SCHEMA_MISMATCH:'SCHEMA_MISMATCH'};
    return fail(map[e.code]??'UNKNOWN');
   }
   return fail('SCHEMA_MISMATCH');
  }
 }
}
