import {getRuntime,staffState} from '../../../../lib/staff-runtime';
import {quoteHandler} from '../../../../lib/quote-http';
import {QuoteService} from '../../../../../../../packages/core/src/pricing/quote-service';
export const dynamic='force-dynamic';
async function handle(request:Request){const r=getRuntime();return quoteHandler(staffState,p=>{if(!r)throw new Error('STORAGE_NOT_CONNECTED');return new QuoteService(r.pricingPool,p);},r?.config.origin??'')(request);}
export const GET=handle;export const POST=handle;
