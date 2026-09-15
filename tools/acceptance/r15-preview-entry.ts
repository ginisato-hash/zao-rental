import type {IncomingMessage,ServerResponse} from 'node:http';
import {handle} from './r15-preview';
/** Finite Node HTTP adapter. No request/response logging or auth-header export. */
export default async function entry(req:IncomingMessage,res:ServerResponse){
 try{
  const host=process.env.VERCEL_URL;
  if(!host||req.headers.host!==host){res.writeHead(404);res.end();return;}
  const chunks:Buffer[]=[];let size=0;
  for await(const chunk of req){const b=Buffer.from(chunk);size+=b.length;if(size>16384){res.writeHead(413);res.end();return;}chunks.push(b);}
  const headers=new Headers();for(const [k,v] of Object.entries(req.headers))if(typeof v==='string')headers.set(k,v);
  const method=req.method??'GET',body=Buffer.concat(chunks);
  const response=await handle(new Request('https://'+host+(req.url??'/'),{method,headers,...(method==='GET'||method==='HEAD'?{}:{body})}));
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
 }catch{res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end('{"classification":"UNKNOWN_DO_NOT_RETRY"}');}
}
