import type {BrowserContext,Page} from '@playwright/test';
import {safeNetworkMetadata} from './safe-network-recorder';
import {safeInitiator} from './phase7-network-observer';
type Input=Parameters<typeof safeNetworkMetadata>[1];
export function rcNetworkMetadata(origin:string,input:Input){
 const safe=safeNetworkMetadata(origin,input);
 if(!('hostname'in safe))return {classification:'BROWSER_INTERNAL' as const,count:1};
 // Exact observed Toolbar script origin, supported by official Vercel docs.
 // This test-only classification does not authorize arbitrary provider domains.
 const platform=safe.scheme==='https'&&safe.hostname==='vercel.live'&&safe.port===443&&safe.resourceType==='script'&&safe.initiatorSource!=='APP_SCRIPT';
 const classification=safe.sameOrigin?'APP':safe.classification==='BROWSER_INTERNAL'?'BROWSER_INTERNAL':safe.initiatorSource==='APP_SCRIPT'?'APP':platform?'PLATFORM_PROVIDER':'UNKNOWN';
 return {scheme:safe.scheme,hostname:safe.hostname,port:safe.port,resourceType:safe.resourceType,initiatorClass:safe.initiatorSource,sameOrigin:safe.sameOrigin,classification,count:1};
}
export async function observeRcNetwork(context:BrowserContext,page:Page,origin:string){
 const records=new Map<string,ReturnType<typeof rcNetworkMetadata>>(),initiators=new Map<string,ReturnType<typeof safeInitiator>>(),cdp=await context.newCDPSession(page);
 const key=(url:string,type:string)=>JSON.stringify(rcNetworkMetadata(origin,{url,resourceType:type.toLowerCase()}));
 const record=(input:Input)=>{const safe=rcNetworkMetadata(origin,input),k=JSON.stringify({...safe,count:0}),prior=records.get(k);if(prior)prior.count++;else records.set(k,safe);return safe;};
 let closed=false;
 await cdp.send('Network.enable');
 cdp.on('Network.requestWillBeSent',event=>{if(!closed)initiators.set(key(event.request.url,event.type??'other'),safeInitiator(origin,event.initiator));});
 await context.route('**/*',async route=>{
  if(closed){await route.abort().catch(()=>{});return;}
  const request=route.request(),url=request.url(),resourceType=request.resourceType();
  const safe=record({url,resourceType,...initiators.get(key(url,resourceType))});
  if(safe.classification==='UNKNOWN'||safe.classification==='APP'&&'sameOrigin'in safe&&!safe.sameOrigin)await route.abort().catch(()=>{});
  else await route.continue();
 });
 await context.routeWebSocket('**/*',socket=>{
  const safe=record({url:socket.url(),resourceType:'websocket'});
  if('sameOrigin'in safe&&safe.sameOrigin)socket.connectToServer();else socket.close();
 });
 return {snapshot:()=>structuredClone([...records.values()]),close:async()=>{closed=true;initiators.clear();await cdp.detach().catch(()=>{});}};
}
