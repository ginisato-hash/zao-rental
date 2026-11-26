import {groupFixture} from './fixture';
const x=await groupFixture(30);let failed=false;
try{
 const token=await x.entrance();
 const h=await x.held(token,3);console.log('held',h.submit);
 console.log((await x.db.pool.query("SELECT allocation_stage,expires_at,state FROM inventory_holds WHERE allocation_stage='GROUP_RESERVED'")).rows);
}catch(e){failed=true;console.error(e);}finally{await x.close();}
if(failed)process.exit(1);
