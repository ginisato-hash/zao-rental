import {modelState} from '../../../../lib/public-content';
export const dynamic='force-dynamic';
export async function GET(_r:Request,p:{params:Promise<{locale:string;slug:string}>}){const {locale,slug}=await p.params;const known=['ja','en'].includes(locale)&&await modelState(slug)==='WITHDRAWN';return new Response(known?(locale==='ja'?'このモデルページの掲載は終了しました。':'This model page has been withdrawn.'):'Not found',{status:known?410:404,headers:{'Content-Type':'text/plain; charset=utf-8','X-Robots-Tag':'noindex, nofollow','Cache-Control':'no-store'}});}
