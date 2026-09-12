import {getRuntime,staffState} from '../../../../lib/staff-runtime';
import {recommendationHandler} from '../../../../lib/recommendation-http';
import {RecommendationService} from '../../../../../../../packages/core/src/recommendation/recommendation-service';
import {HoldService} from '../../../../../../../packages/core/src/inventory/hold-service';
import {QuoteService} from '../../../../../../../packages/core/src/pricing/quote-service';
import {RecommendationError} from '../../../../../../../packages/contracts/src/recommendation';
export const dynamic='force-dynamic';
async function handle(request:Request){const r=getRuntime();return recommendationHandler(staffState,p=>{if(!r)throw new RecommendationError('STORAGE_NOT_CONNECTED',503);return new RecommendationService(r.recommendationPool,p,new HoldService(r.holdPool,p),new QuoteService(r.pricingPool,p));},r?.config.origin??'')(request);}
export const GET=handle;export const POST=handle;
