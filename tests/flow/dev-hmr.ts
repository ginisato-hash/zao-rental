import type {Browser,BrowserContext} from '@playwright/test';

/** AVATAR-CI-02. The synthetic test apps run `next dev`, whose hot-reload socket (Next 16 app router `/_next/hmr?id=…`;
 * older webpack clients `/_next/webpack-hmr`) reloads every open page when the dev server's compilation changes: a `sync`
 * message whose hash differs from the previous one runs `location.reload()` directly
 * (next/dist/client/dev/hot-reloader/app/web-socket.js handleMessage), and `reloadPage`, a failed hot update after `built`,
 * or `serverComponentChanges` after an error do the same. During a test nothing edits the source, so these only happen
 * because another route was compiled on demand, and they abort whatever the page is doing (CI #44764308823: a reload
 * initiated from web-socket.js:handleMessage 10 ms after the guest logout POST, recorded by the CDP navigation trace).
 * Production builds have no such socket.
 *
 * The socket stays connected to the dev server (it also carries on-demand compilation and other dev traffic the pages
 * need; silencing it entirely broke the guest pages) and page→server traffic is forwarded untouched. Server→page:
 *  - `sync` and `built` are always delivered (a page that loaded during a compile waits for `built` before hydrating:
 *    dropping it left the guest page uninitialised after a dev restart in CI #44828188951), but a later hash is rewritten
 *    to the first hash this connection received, so the page sees "nothing changed": no reload, no hot swap;
 *  - messages that only reload or hot-swap (reloadPage, serverComponentChanges, ...) are dropped.
 * What is NOT changed (TD #7053195635): the errors/warnings that sync/built carry, serverError and every other message
 * type, binary frames, page→server traffic, ordinary API responses and any reload the product itself performs. The hash
 * baseline is per connection: after a reconnect (dev server restart, new document) the first sync is delivered as sent,
 * so the page's own restart detection and initialisation work as in normal development.
 * `dropped` / `rewritten` count what was changed, so a test can show the guard applied.
 * The earlier pattern matched only `/_next/webpack-hmr` and never applied. */
export const DEV_HMR_SOCKET=/\/_next\/(?:webpack-)?hmr(?:[?#]|$)/;
const RELOADING=new Set(['reloadPage','serverComponentChanges','staticParamsChanged','middlewareChanges','clientChanges','serverOnlyChanges','addedPage','removedPage']);

export type DevHmrGuard={sockets:number;dropped:Record<string,number>;rewritten:number};
export async function guardDevHmr(context:BrowserContext):Promise<DevHmrGuard>{
 const guard:DevHmrGuard={sockets:0,dropped:{},rewritten:0};
 await context.routeWebSocket(DEV_HMR_SOCKET,ws=>{
  guard.sockets++;const server=ws.connectToServer();let base:string|null=null;
  server.onMessage(message=>{
   if(typeof message==='string'){
    type HmrMessage={type?:unknown;action?:unknown;hash?:unknown};
    const m=((()=>{try{const v:unknown=JSON.parse(message);return v&&typeof v==='object'?v as HmrMessage:null;}catch{return null;/* not JSON: forward */}})());
    const type=m?String(m.type??m.action??''):'';
    if(RELOADING.has(type)){guard.dropped[type]=(guard.dropped[type]??0)+1;return;}
    if(m&&(type==='sync'||type==='built')&&typeof m.hash==='string'){
     if(base===null)base=m.hash;
     else if(m.hash!==base){m.hash=base;guard.rewritten++;ws.send(JSON.stringify(m));return;}
    }
   }
   ws.send(message);
  });
 });
 return guard;
}

/** browser.newContext with the dev reload messages dropped (see above). */
export async function newQuietContext(browser:Browser,options?:Parameters<Browser['newContext']>[0]){
 const context=await browser.newContext(options);await guardDevHmr(context);return context;
}
