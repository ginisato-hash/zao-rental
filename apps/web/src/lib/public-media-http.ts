import type {Pool} from 'pg';
import {releasedDerivative} from '../../../../packages/core/src/content/storage-port';
import {releasedModels} from '../../../../packages/core/src/content/public-catalog';
/** The normal catalog-media boundary requires current release/rights before and
 * after the private read. It does not require a guest or staff booking runtime. */
export function publicMediaHandler(boundary:{pool:Pool;readBytes:(digest:string)=>Promise<Buffer|null>}|null){return async(req:Request)=>{
 const empty=()=>new Response(null,{status:404,headers:{'Cache-Control':'no-store'}});
 if(req.method!=='GET'&&req.method!=='HEAD')return new Response(null,{status:405,headers:{Allow:'GET, HEAD','Cache-Control':'no-store'}});
 const url=new URL(req.url);if(url.search||!/^\/media\/[a-f0-9]{64}\/\d+\.(?:webp|jpg)$/.test(url.pathname)||!boundary)return empty();
 const path=url.pathname,hash=path.split('/')[2]!;
 try{const result=await releasedDerivative(path,{readPrivateObject:boundary.readBytes},async()=>{const model=(await releasedModels(boundary.pool)).find(m=>m.media.variants.some(v=>v.src===path)),variant=model?.media.variants.find(v=>v.src===path);return model&&variant?{path,sha256:hash,type:variant.type,revision:JSON.stringify(model)}:null;});
  if(!result)return empty();return new Response(req.method==='HEAD'?null:new Uint8Array(result.bytes),{headers:{...result.headers,'Content-Type':result.type,'Content-Length':String(result.bytes.length)}});
 }catch{return empty();}
};}
