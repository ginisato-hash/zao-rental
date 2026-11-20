import type {Locator,Page,Request,Response} from '@playwright/test';

/** AVATAR-CI-01 (TD #7032214753): press the guest "close this booking screen" button and return the logout answer.
 * The request listener is registered before any click, so an immediate POST and answer are never missed. The button is
 * pressed again only if no logout POST was observed after a click (a click that landed while the button was disabled);
 * once a POST was issued it is never sent again: its own answer is awaited, and a missing answer fails with the reason. */
export async function closeGuestAndAwaitLogout(page:Page,close:Locator,opts:{path?:string;attempts?:number;observeMs?:number;answerMs?:number}={}):Promise<Response>{
 const path=opts.path??'/api/guest/logout',attempts=opts.attempts??5,observeMs=opts.observeMs??2000,answerMs=opts.answerMs??30000;
 let sent:Request|null=null;const clicks:string[]=[];
 const onRequest=(r:Request)=>{if(!sent&&r.method()==='POST'&&new URL(r.url()).pathname===path)sent=r;};
 page.on('request',onRequest);
 try{
  for(let i=0;i<attempts&&!sent;i++){
   // Wait until the button can be pressed (not while the page is busy); a missing button ends the attempt with its reason.
   await close.waitFor({state:'visible',timeout:answerMs});
   const handle=await close.elementHandle({timeout:answerMs});if(!handle)throw new Error('close button missing');
   await page.waitForFunction(el=>!(el as HTMLButtonElement).disabled,handle,{timeout:answerMs});
   await close.click({timeout:answerMs});clicks.push('click');
   for(const until=Date.now()+observeMs;!sent&&Date.now()<until;)await new Promise(r=>setTimeout(r,25));
   if(!sent)clicks.push('no-request');
  }
  if(!sent)throw new Error(`logout POST never issued after ${clicks.filter(c=>c==='click').length} click(s): ${clicks.join(',')}`);
  const issued=sent as Request;
  const answer=await Promise.race([issued.response(),new Promise<null>(r=>setTimeout(()=>r(null),answerMs))]);
  if(!answer)throw new Error(`logout POST issued but no answer within ${answerMs} ms${issued.failure()?': '+issued.failure()!.errorText:''}`);
  return answer;
 }finally{page.off('request',onRequest);}
}
