// Local R67 visual check of the booking flow against the preview server (synthetic input only):
// DATES with an afternoon start, GEAR with one person choosing individual ski + boots + poles, SIZE candidates.
import {chromium,type Page} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {fillGuestProfile} from '../public/guest-profile';
const base=process.argv[2]??'http://127.0.0.1:33474',out='.local/r67-shots';mkdirSync(out,{recursive:true});
const browser=await chromium.launch(process.env.R67_CHROME?{executablePath:process.env.R67_CHROME}:{});
async function shot(p:Page,name:string){await p.waitForTimeout(500);await p.screenshot({path:`${out}/${name}-fv.png`});await p.screenshot({path:`${out}/${name}-full.png`,fullPage:true});}
try{
 for(const [locale,w,h] of [['ja',390,844],['ja',1440,900],['en',390,844],['en',1440,900]] as const){
  const ja=locale==='ja',t=(j:string,e:string)=>ja?j:e;
  const ctx=await browser.newContext({viewport:{width:w,height:h}});const p=await ctx.newPage();await p.addInitScript('window.__name=(f)=>f');
  await p.goto(base+'/'+locale+'/book');await p.getByLabel(t('利用開始日','Start date'),{exact:true}).waitFor();
  await p.getByLabel(t('利用開始日','Start date'),{exact:true}).fill('2035-02-05');await p.getByLabel(t('利用終了日','End date'),{exact:true}).fill('2035-02-07');
  await p.getByRole('radio',{name:new RegExp(t('午後から','From afternoon'))}).check();await p.getByRole('radio',{name:new RegExp(t('昼まで','By noon'))}).check();
  await shot(p,`book-${locale}-dates-${w}`);
  await p.getByRole('button',{name:'CONTINUE'}).click();
  await p.getByLabel(t('用品','Equipment'),{exact:true}).selectOption('INDIVIDUAL');
  for(const x of ['BOOTS','POLES'])await p.getByRole('checkbox',{name:new RegExp('^'+x)}).check();
  await fillGuestProfile(p,locale);
  await shot(p,`book-${locale}-gear-${w}`);
  await p.getByRole('button',{name:t('候補と参考料金を確認','Review sizes and estimates')}).click();
  await p.locator('.guest-candidates').first().waitFor({timeout:30000}).catch(()=>{});
  await shot(p,`book-${locale}-size-${w}`);
  await ctx.close();console.log('OK '+locale+' '+w);
 }
}finally{await browser.close();}
