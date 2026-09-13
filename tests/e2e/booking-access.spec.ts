import {test,expect} from '@playwright/test';
test('production booking access stays unconfigured; client flags cannot activate it',async({request})=>{
 const r=await request.get('/api/booking-access');expect(r.status()).toBe(503);expect(await r.json()).toEqual({error:'BOOKING_ACCESS_UNCONFIGURED'});expect(r.headers()['set-cookie']).toBeUndefined();
 const p=await request.post('/api/booking-access/issue',{data:{productionEnabled:true,role:'ADMIN',bookingId:'00000000-0000-4000-8000-000000000000',requestId:'00000000-0000-4000-8000-000000000000'}});expect(p.status()).toBe(503);expect(p.headers()['set-cookie']).toBeUndefined();
});
