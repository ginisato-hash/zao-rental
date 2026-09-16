import type {BrowserContext,Page} from '@playwright/test';
import {SafeNetworkRecorder,safeNetworkMetadata} from './safe-network-recorder';
type Initiator={type?:string;stack?:{callFrames?:{url?:string}[];parent?:Initiator['stack']}};
export function safeInitiator(origin:string,initiator:Initiator){
  const type=['parser','script','preload','other'].includes(initiator.type??'')?initiator.type!:'unknown';
  let stack=initiator.stack,source='UNKNOWN';
  for(let depth=0;stack&&depth<6;depth++,stack=stack.parent){for(const frame of stack.callFrames??[]){try{
    const url=new URL(frame.url??'');
    if(url.origin===origin&&url.pathname.startsWith('/_next/static/'))source='APP_SCRIPT';
    else if(source==='UNKNOWN'&&['chrome:','devtools:','chrome-extension:','moz-extension:','safari-web-extension:'].includes(url.protocol))source='BROWSER_INTERNAL';
  }catch{ /* No raw URL/error is retained. */ }}}
  return {initiatorType:type,initiatorSource:source};
}
export async function observeUnexpectedNetwork(context:BrowserContext,page:Page,origin:string){
  const recorder=new SafeNetworkRecorder(origin),cdp=await context.newCDPSession(page),initiators=new Map<string,ReturnType<typeof safeInitiator>>();
  let ended=false,resolve:()=>void=()=>{};
  const detected=new Promise<void>(r=>{resolve=r;});
  const key=(url:string,type:string)=>{const safe=safeNetworkMetadata(origin,{url,resourceType:type.toLowerCase()});return JSON.stringify('hostname'in safe?[safe.scheme,safe.hostname,safe.port,safe.resourceType]:[safe.classification]);};
  await cdp.send('Network.enable');
  cdp.on('Network.requestWillBeSent',(event:{request:{url:string};type?:string;initiator:Initiator})=>{
    if(!ended)initiators.set(key(event.request.url,event.type??'other'),safeInitiator(origin,event.initiator));
  });
  await context.route('**/*',async route=>{
    if(ended){await route.abort().catch(()=>{});return;}
    const request=route.request(),url=request.url(),resourceType=request.resourceType();
    const metadata={url,resourceType,...initiators.get(key(url,resourceType))},safe=safeNetworkMetadata(origin,metadata);
    if('blocked'in safe&&!safe.blocked){await route.continue();return;}
    ended=true;recorder.record(metadata);
    await route.abort().catch(()=>{});resolve();
  });
  return {detected,snapshot:()=>recorder.snapshot(),close:async()=>{ended=true;initiators.clear();await cdp.detach().catch(()=>{});}};
}
