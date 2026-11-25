import {getRuntime,staffState} from '../../../../lib/staff-runtime';
import {couponHandler,type CouponAdminService} from '../../../../lib/coupon-http';
import {QuoteService} from '../../../../../../../packages/core/src/pricing/quote-service';
export const dynamic='force-dynamic';
async function handle(request:Request){const r=getRuntime();return couponHandler(staffState,p=>{if(!r)throw new Error('STORAGE_NOT_CONNECTED');return new QuoteService(r.pricingPool,p) as unknown as CouponAdminService;},r?.config.origin??'')(request);}
export const GET=handle;export const POST=handle;
