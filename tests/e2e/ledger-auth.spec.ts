import {test,expect} from '@playwright/test';
test('production ledger pages and every API operation stay denied; test app is not a production route',async({page,request})=>{
 await page.goto('/staff/ledger');await expect(page.getByRole('heading',{name:'認証が必要です'})).toBeVisible();await expect(page.getByRole('button',{name:'＋ 登録'})).toHaveCount(0);
 for(const resource of ['models','variants','assets','poles','bundles'])for(const method of ['GET','POST','PATCH']){
   const response=await request.fetch(`/api/ledger/${resource}${method==='PATCH'?'/00000000-0000-4000-8000-000000000201':''}`,{method,headers:{'x-role':'ADMIN','cookie':'role=ADMIN; testAuth=1','content-type':'application/json'},...(method==='GET'?{}:{data:{admin:true}})});
   expect(response.status()).toBe(401);expect(await response.json()).toEqual({error:'AUTHENTICATION_REQUIRED'});expect(response.headers()['cache-control']).toContain('no-store');
 }
 expect((await request.get('/test-ledger')).status()).toBe(404);expect((await request.get('/tests/ui-app')).status()).toBe(404);
});
