import {bookingAccessRuntime} from '../../../../lib/booking-access-runtime';
import {bookingAccessHandler} from '../../../../lib/booking-access-http';
export const dynamic='force-dynamic';
export const GET=async(r:Request)=>{
 try{const runtime=bookingAccessRuntime();if(runtime)return bookingAccessHandler(runtime.access,runtime.p.contexts,runtime.p.r.config.origin,runtime.guard,runtime.recovery)(r);}catch{}
 return Response.json({error:'BOOKING_ACCESS_UNCONFIGURED'},{status:503,headers:{'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'}});
};
export const POST=GET;
