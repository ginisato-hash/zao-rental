import {randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import {RECOMMENDATION_RULE,MODEL_POLICY,type Profile} from '../../packages/contracts/src/recommendation';
import type {HoldConditions} from '../../packages/contracts/src/hold';
import type {PreparationInput,PreparationMember} from '../../packages/contracts/src/preparation';
/** Test-owned reservation body data for lower-level custody fixtures created without a guest funnel. */
export async function recordSyntheticBookingProfile(pool:Pool,bookingId:string){
 const c=await pool.connect();try{await c.query('BEGIN');
  const b=(await c.query<{id:string;owner_id:string;quote_id:string;hold_id:string;conditions:HoldConditions}>('SELECT * FROM rental_bookings WHERE id=$1',[bookingId])).rows[0]!;
  if(!(await c.query('SELECT 1 FROM recommendation_selections WHERE quote_id=$1',[b.quote_id])).rowCount){
   const members:Profile[]=b.conditions.members.map(m=>{const sport=m.product==='WEAR_SET'?'WEAR':m.items.some(i=>i.family.startsWith('SNOWBOARD'))?'SNOWBOARD':'SKI';return {key:m.key,sport,heightCm:sport==='WEAR'?null:170,footCm:sport==='WEAR'?null:25.5,adultAtStart:m.age==='ADULT',tier:m.tier,ski:sport==='SKI'?{weightKg:60,ageAtStart:m.age==='ADULT'?30:10,skierType:'TYPE_I'}:null,poleVariantId:m.items.find(i=>i.family==='POLE')?.variantIds[0]??null};});
   const id=randomUUID();await c.query("SELECT set_config('zao.actor',$1,true)",[b.owner_id]);
   await c.query('INSERT INTO recommendation_previews(id,owner_id,request_key,fingerprint,rule_version,model_policy,input,offered,reservation_id) VALUES($1,$2,$3,$4,$5,$6,$7,\'[]\',$8)',[id,b.owner_id,randomUUID(),'0'.repeat(64),RECOMMENDATION_RULE,MODEL_POLICY,JSON.stringify({pickupStore:b.conditions.pickupStore,returnStore:b.conditions.returnStore,period:b.conditions.period,members}),b.id]);
   await c.query("INSERT INTO recommendation_selections(preview_id,owner_id,request_key,fingerprint,selection,conditions,hold_key,quote_key,hold_id,quote_id,stage) VALUES($1,$2,$3,$4,'{}',$5,$6,$7,$8,$9,'COMPLETE')",[id,b.owner_id,randomUUID(),'0'.repeat(64),JSON.stringify(b.conditions),randomUUID(),randomUUID(),b.hold_id,b.quote_id]);
  }
  await c.query('COMMIT');
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
/** Explicit synthetic physical observation (314 mm), independent of Mondo and model. */
export function syntheticPreparation(view:{preparationMembers:PreparationMember[]}):PreparationInput{
 return {version:'ZAO_PREP_V2',members:view.preparationMembers.map(m=>({memberKey:m.memberKey,bootAssetId:m.bootAssetId,bslMm:m.bootAssetId||m.ownBoot?m.bslMm??314:null,ownBootConfirmed:m.ownBoot,equipmentConfirmed:true,bindingCompatibilityConfirmed:m.needsBinding,bindingSetupConfirmed:m.needsBinding,poleSelectedCm:m.needsPole?Number.parseFloat(m.items.find(i=>i.family==='POLE')?.size??'')||m.poleSuggestedCm:null,wearPrepared:m.needsWear}))};
}
