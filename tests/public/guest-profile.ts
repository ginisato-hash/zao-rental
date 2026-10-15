import type {Locator,Page} from '@playwright/test';
/** Explicitly enters the body/safety values a guest must type (the form no longer starts with any). Fields the test already set are kept. */
export type GuestProfile={heightCm?:number;footCm?:number;weightKg?:number;ageAtStart?:number;skierType?:'TYPE_I'|'TYPE_II'|'TYPE_III'};
export const skierTypeName=(locale:'ja'|'en',type:NonNullable<GuestProfile['skierType']>)=>new RegExp('^'+(locale==='ja'?{TYPE_I:'タイプI：',TYPE_II:'タイプII：',TYPE_III:'タイプIII：'}:{TYPE_I:'Type I:',TYPE_II:'Type II:',TYPE_III:'Type III:'})[type]);
export async function fillGuestProfile(scope:Page|Locator,locale:'ja'|'en'='ja',values:GuestProfile={}){
 // Multi-person forms show one person card at a time: open each in turn, as a guest would.
 const cards=scope.locator('details.guest-person-toggle');
 if(await cards.count()){for(const card of await cards.all()){for(let pass=0;pass<5;pass++){
   for(let n=0;n<5&&!await card.evaluate(e=>(e as HTMLDetailsElement).open);n++){await card.locator('summary').click();await card.page().waitForTimeout(150);}
   await fillOne(card,locale,values);
   // Done once no required number is empty and any skier-type group has a choice (checked regardless of visibility).
   if(await card.evaluate(e=>[...e.querySelectorAll('input[type=number][aria-required=true]')].every(i=>(i as HTMLInputElement).value!=='')&&[...e.querySelectorAll('.guest-skier-type')].every(g=>!!g.querySelector('input:checked'))))break;
  }}return;}
 await fillOne(scope,locale,values);
}
async function fillOne(scope:Page|Locator,locale:'ja'|'en',values:GuestProfile){
 const t=(j:string,e:string)=>locale==='ja'?j:e,v={heightCm:170,footCm:25.5,weightKg:60,ageAtStart:30,skierType:'TYPE_I' as const,...values};
 for(const [label,value] of [[t('身長（cm）','Height (cm)'),v.heightCm],[t('足のサイズ（cm）','Foot size (cm)'),v.footCm],[t('体重（kg）','Weight (kg)'),v.weightKg],[t('年齢','Age at start'),v.ageAtStart]] as const){
  for(const field of await scope.getByLabel(label,{exact:true}).all())if(await field.isVisible()&&await field.inputValue()==='')await field.fill(String(value));
 }
 const group=scope.getByRole('radiogroup',{name:locale==='ja'?'滑り方（ビンディング設定用）':'How you ski (for binding settings)'});
 for(const one of await group.all())if(await one.isVisible()&&!await one.getByRole('radio',{checked:true}).count())await one.getByRole('radio',{name:skierTypeName(locale,v.skierType)}).check();
}
/** R67 V1.4: choose one person's individual items (rectangular checkboxes; sport chosen first). */
export async function chooseIndividual(scope:Page|Locator,locale:'ja'|'en',items:string[]){
 const t=(j:string,e:string)=>locale==='ja'?j:e,sport=items.some(f=>f.startsWith('SNOWBOARD'))?'SNOWBOARD':'SKI',board=sport;
 await scope.getByLabel(t('用品','Equipment'),{exact:true}).selectOption('INDIVIDUAL');
 await scope.getByLabel(t('スポーツ','Sport'),{exact:true}).selectOption(sport);
 const word:Record<string,string>={SKI:'SKIS',SKI_BOOT:'BOOTS',POLE:'POLES',SNOWBOARD:'BOARD',SNOWBOARD_BOOT:'BOOTS'};
 for(const f of items)if(f!==board)await scope.getByRole('checkbox',{name:new RegExp('^'+word[f])}).check();
 if(!items.includes(board))await scope.getByRole('checkbox',{name:new RegExp('^'+word[board])}).uncheck();
}
