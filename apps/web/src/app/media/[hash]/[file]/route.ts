import {productionRequested,getProductionRuntime} from '../../../../lib/production-runtime';
import {publicContentPool} from '../../../../lib/public-runtime';
import {publicMediaHandler} from '../../../../lib/public-media-http';
export const dynamic='force-dynamic';
export async function GET(req:Request){
 const p=publicContentPool(),r=productionRequested()?getProductionRuntime():null;
 const boundary=p&&(!productionRequested()||r?.configuration.flags.media)?{pool:p,readBytes:async(digest:string)=>r?r.readDerivative(digest):(await p.query('SELECT bytes FROM content_media_objects WHERE sha256=$1',[digest])).rows[0]?.bytes??null}:null;
 return publicMediaHandler(boundary)(req);
}
