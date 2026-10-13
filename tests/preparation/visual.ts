/** R65 local-only, real API/database evidence. Providers remain simulated. */
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import type {Page,Locator} from '@playwright/test';
export const visualOutput=process.env.ZAO_VISUAL_OUTPUT??'.local/r65/production-copy';
mkdirSync(visualOutput,{recursive:true});
const records:object[]=[];
export async function capture(p:Page,name:string,region?:Locator){
 for(const width of [390,1440]){
  await p.setViewportSize({width,height:width===390?844:900});await p.mouse.move(0,0);await p.evaluate(()=>document.fonts.ready);
  const target=region??p.locator('body'),text=await target.innerText();
  assert.doesNotMatch(text,/SYNTHETIC|合成|CONFIRMED_DEV|PREPARATION_FIXED|PICKUP_WINDOW|person-[a-z0-9]+:|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i,name);
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth-innerWidth),0,name+' overflow');
  writeFileSync(`${visualOutput}/${name}-${width}.txt`,text);
  if(region)await region.screenshot({path:`${visualOutput}/${name}-${width}.png`,animations:'disabled'});
  else await p.screenshot({path:`${visualOutput}/${name}-${width}.png`,fullPage:true,animations:'disabled'});
  records.push({name,width,scope:region?'component':'page',productionCopy:true,data:'synthetic fixture',realProviderWrites:0});console.log('CAPTURE '+name+' '+width);
 }
}
export function saveManifest(name:string){writeFileSync(`${visualOutput}/${name}-captures.json`,JSON.stringify(records,null,2));}
