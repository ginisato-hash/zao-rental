import {randomUUID} from 'node:crypto';
import type {WearService} from '../../packages/core/src/wear/service';
import type {LedgerService} from '../../packages/core/src/catalog/ledger-service';
// All registration uses the same service/validation/audit as the normal API.
export async function registerWear(ledger:LedgerService,wear:WearService){
 const source=(sourceLocator:string)=>({notes:'SYNTHETIC v1.2; not real stock',sourceKind:'SYNTHETIC',sourceDocument:'tests/wear/fixture.ts',sourceLocator});
 const models:Record<string,string>={},variants:Record<string,string>={},assets:Record<string,string[]>={};
 for(const family of ['WEAR_JACKET','WEAR_PANTS','SKI','SKI_BOOT','POLE'] as const){const m=await ledger.create('models',{...source(family+'-model'),code:'WEAR-TEST-'+family,name:'合成 '+family,brand:'SYNTHETIC',family,catalogSeason:'2026/27'});models[family]=m.id;
  for(const size of family==='SKI'?['150 cm','155 CM']:family==='SKI_BOOT'?['26.5 CM']:family==='POLE'?['110 cm']:['M','L']){const v=await ledger.create('variants',{...source(family+'-'+size),modelId:m.id,family,age:'ADULT',tier:family.startsWith('WEAR_')?'STANDARD':'PREMIUM',size,...(family.startsWith('WEAR_')?{compatibleSports:['SKI','SNOWBOARD']}:{})});variants[family+'-'+size]=v.id;
   if(family==='POLE')await ledger.create('poles',{...source(family+'-quantity'),variantId:v.id,storeId:'MOUNTAIN_BASE',quantity:2,status:'AVAILABLE'});
   else if(family.startsWith('WEAR_')){await wear.register(randomUUID(),{variantId:v.id,store:'MOUNTAIN_BASE',quantity:2,reason:'SYNTHETIC initial fixture; no real stock'});}
   else{assets[v.id]=[];for(let n=0;n<2;n++){const a=await ledger.create('assets',{...source(family+'-'+size+'-asset'+n),family,variantId:v.id,storeId:'MOUNTAIN_BASE',status:'AVAILABLE',bslStatus:family==='SKI_BOOT'?'UNVERIFIED':'NOT_APPLICABLE',bslMm:null,bslEvidence:''});assets[v.id]!.push(a.id);}}
  }
 }
 return {models,variants,assets,selection:{jacketVariantId:variants['WEAR_JACKET-M']!,pantsVariantId:variants['WEAR_PANTS-L']!}};
}
