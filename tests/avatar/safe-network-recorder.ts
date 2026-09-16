const resourceTypes=new Set(['document','stylesheet','image','media','font','script','texttrack','xhr','fetch','eventsource','websocket','manifest','other']);
const initiatorTypes=new Set(['parser','script','preload','other','browser/platform','unknown']);
const initiatorSources=new Set(['APP_SCRIPT','PLATFORM_SCRIPT','BROWSER_INTERNAL','UNKNOWN']);
export type SafeNetworkRecord={classification:'BROWSER_EXTENSION';count:number}|{
  scheme:string;hostname:string;port:number|null;resourceType:string;initiatorType:string;
  initiatorSource:string;sameOrigin:boolean;classification:'FIRST_PARTY'|'THIRD_PARTY'|'BROWSER_INTERNAL'|'UNKNOWN';blocked:boolean;count:number;
};
export function safeNetworkMetadata(targetOrigin:string,input:{url:string;resourceType?:string;initiatorType?:string;initiatorSource?:string}):SafeNetworkRecord{
  let url:URL;try{url=new URL(input.url);}catch{return {scheme:'other',hostname:'',port:null,resourceType:'other',initiatorType:'unknown',initiatorSource:'UNKNOWN',sameOrigin:false,classification:'UNKNOWN',blocked:true,count:1};}
  if(['chrome-extension:','moz-extension:','safari-web-extension:'].includes(url.protocol))return {classification:'BROWSER_EXTENSION',count:1};
  const network=['https:','http:','wss:','ws:'].includes(url.protocol),internal=['data:','blob:','about:','chrome:','devtools:','file:'].includes(url.protocol);
  const scheme=network||internal?url.protocol.slice(0,-1):'other',sameOrigin=network&&url.origin===new URL(targetOrigin).origin;
  return {scheme,hostname:network?url.hostname:'',port:network?Number(url.port||(['https:','wss:'].includes(url.protocol)?443:80)):null,
    resourceType:resourceTypes.has(input.resourceType??'')?input.resourceType!:'other',
    initiatorType:initiatorTypes.has(input.initiatorType??'')?input.initiatorType!:'unknown',
    initiatorSource:initiatorSources.has(input.initiatorSource??'')?input.initiatorSource!:'UNKNOWN',sameOrigin,
    classification:sameOrigin?'FIRST_PARTY':network?'THIRD_PARTY':internal?'BROWSER_INTERNAL':'UNKNOWN',blocked:!sameOrigin&&!['data:','blob:','about:'].includes(url.protocol),count:1};
}
export class SafeNetworkRecorder{
  private records=new Map<string,SafeNetworkRecord>();
  constructor(private targetOrigin:string){}
  record(input:Parameters<typeof safeNetworkMetadata>[1]){
    const record=safeNetworkMetadata(this.targetOrigin,input),key=JSON.stringify({...record,count:0}),prior=this.records.get(key);
    if(prior)prior.count++;else this.records.set(key,record);
    return structuredClone(record);
  }
  snapshot(){return [...this.records.values()].map(r=>structuredClone(r));}
}
