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
 * need; silencing it entirely broke the guest pages), page→server traffic is forwarded untouched, and only the
 * server→page messages that reload or hot-swap the page are dropped. `dropped` counts them, so a test can show the guard
 * applied. Binary frames are forwarded unchanged. The earlier pattern matched only `/_next/webpack-hmr` and never applied. */
export const DEV_HMR_SOCKET=/\/_next\/(?:webpack-)?hmr(?:[?#]|$)/;
const RELOADING=new Set(['reloadPage','built','building','serverComponentChanges','staticParamsChanged','middlewareChanges','clientChanges','serverOnlyChanges','addedPage','removedPage']);

export type DevHmrGuard={sockets:number;dropped:Record<string,number>};
export async function guardDevHmr(context:BrowserContext):Promise<DevHmrGuard>{
 const guard:DevHmrGuard={sockets:0,dropped:{}};
 await context.routeWebSocket(DEV_HMR_SOCKET,ws=>{
  guard.sockets++;const server=ws.connectToServer();let synced=false;
  server.onMessage(message=>{
   if(typeof message==='string'){
    let type='';try{const m=JSON.parse(message) as {type?:unknown;action?:unknown};type=String(m.type??m.action??'');}catch{/* not JSON: forward */}
    // The first sync of a connection sets the page's baseline hash; a later one with another hash would reload it.
    const drop=RELOADING.has(type)||(type==='sync'&&synced);if(type==='sync')synced=true;
    if(drop){guard.dropped[type]=(guard.dropped[type]??0)+1;return;}
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
