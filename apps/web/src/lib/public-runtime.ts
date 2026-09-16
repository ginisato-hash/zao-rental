import {productionRequested,getProductionRuntime} from './production-runtime';
import 'server-only';
import {Pool} from 'pg';
import {getRuntime} from './staff-runtime';
import type {Connection} from '../../../../packages/auth/src/config';
import type {GuestActor} from '../../../../packages/auth/src/booking-actor';
import {GuestContexts} from '../../../../packages/core/src/guest/context';
import {GuestBookingService} from '../../../../packages/core/src/guest/service';
import {HoldService} from '../../../../packages/core/src/inventory/hold-service';
import {QuoteService} from '../../../../packages/core/src/pricing/quote-service';
import {RecommendationService} from '../../../../packages/core/src/recommendation/recommendation-service';
import type {BookingService} from '../../../../packages/core/src/payment/booking-service';
import {guestCatalog,guestVariants} from '../../../../packages/core/src/content/public-catalog';
let guestPool:Pool|undefined,readPool:Pool|undefined,contentPool:Pool|undefined;
function connection(raw:string|undefined,suffix:string){const runtime=getRuntime();if(!runtime||process.env.NODE_ENV==='production'||!raw)return null;const c=JSON.parse(raw) as Connection;if(c.host!=='127.0.0.1'||c.database!==runtime.config.namespace||c.user!==runtime.config.namespace+'_'+suffix||c.port!==runtime.config.authDb.port||!c.password)throw new Error('PUBLIC_RUNTIME_INVALID');return c;}
export function publicRuntime(){if(productionRequested())return getProductionRuntime()?.public??null;const r=getRuntime(),g=connection(process.env.ZAO_GUEST_RUNTIME,'guest'),c=connection(process.env.ZAO_CONTENT_READ_RUNTIME,'content_read');if(!r||!g||!c)return null;if(!guestPool){guestPool=new Pool({...g,max:4});guestPool.on('error',()=>{});}if(!readPool){readPool=new Pool({...c,max:4});readPool.on('error',()=>{});}return {r,guestPool,readPool,contexts:new GuestContexts(guestPool)};}
export function guestService(actor:GuestActor,booking?:BookingService){if(productionRequested()){const r=getProductionRuntime();if(!r?.guest||booking)throw new Error('PUBLIC_RUNTIME_UNCONNECTED');return r.service(actor);}const p=publicRuntime();if(!p)throw new Error('PUBLIC_RUNTIME_UNCONNECTED');const holds=new HoldService(p.r.holdPool,actor),quotes=new QuoteService(p.r.pricingPool,actor),recs=new RecommendationService(p.r.recommendationPool,actor,holds,quotes,async variants=>guestVariants(await guestCatalog(p.readPool,variants),variants));return new GuestBookingService(p.contexts,actor,recs,booking??null,async()=>guestCatalog(p.readPool,await holds.recommendationCatalog()));}

export function contentRuntime(){if(productionRequested())return null;const r=getRuntime(),c=connection(process.env.ZAO_CONTENT_RUNTIME,'content');if(!r||!c)return null;if(!contentPool){contentPool=new Pool({...c,max:4});contentPool.on('error',()=>{});}return {r,contentPool};}

/** Catalog/media reads do not require an enabled guest booking context. */
export function publicContentPool(){if(productionRequested())return getProductionRuntime()?.contentReadPool??null;return publicRuntime()?.readPool??null;}
