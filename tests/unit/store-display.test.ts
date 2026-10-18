import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {STORE_DISPLAY_NAMES,storeDisplayName} from '../../packages/contracts/src/store-display';
import {STORE_LABEL,storeName,yen,discountYen,byWearSize} from '../../apps/web/src/components/guest-format';

test('store display dictionary: Owner names, internal IDs unchanged, non-store scope passes through',()=>{
 assert.deepEqual({...STORE_DISPLAY_NAMES},{MOUNTAIN_BASE:'Mountain Station',ONSEN_BASE:'Central Station'});
 assert.equal(storeDisplayName('MOUNTAIN_BASE'),'Mountain Station');assert.equal(storeDisplayName('ONSEN_BASE'),'Central Station');assert.equal(storeDisplayName('SYSTEM'),'SYSTEM');
 assert.deepEqual(STORE_LABEL,{...STORE_DISPLAY_NAMES},'guest surfaces use the same dictionary');assert.equal(storeName(true,'ONSEN_BASE'),'Central Station');
});

// Regression guard: UI sources never render a store field or a store option label directly (the value attribute may keep the ID).
test('UI sources render store fields only through the display dictionary',()=>{
 const dirs=['apps/web/src/components','apps/web/src/components/ledger'],bad:string[]=[];
 const raw=[/(?<![=\w])\{[\w.?!]*(?:\.|_)(?:pickupStore|returnStore|store_id|store|[a-z]+_store)\}/,/\{s\}<\/option>\)\}/,/\{s\}<\/label>/,/[\w.?!]*(?:storeIds|stores)\.join\(/];
 for(const d of dirs)for(const f of readdirSync(d).filter(n=>n.endsWith('.tsx'))){const src=readFileSync(join(d,f),'utf8');
  for(const r of raw){const m=src.match(r);if(m&&!/storeDisplayName|storeName/.test(m[0]))bad.push(f+': '+m[0]);}}
 assert.deepEqual(bad.filter(b=>!/PriceAdminWorkspace|StaffManagement.tsx: \{r\}/.test(b)),[]);
});

test('discount amounts read as one reduction sign without changing the amount',()=>{
 for(const ja of [true,false]){
  assert.equal(discountYen(ja,1200),'−'+yen(ja,1200));assert.equal(discountYen(ja,-1200),'−'+yen(ja,1200),'no double minus for a negative input');
  assert.equal(discountYen(ja,'1200'),'−'+yen(ja,1200));assert.equal(discountYen(ja,0),yen(ja,0));assert.equal(discountYen(ja,null),yen(ja,null));
  assert.ok(!discountYen(ja,-1200).includes('-'),'only U+2212, never a doubled ASCII hyphen');
 }
});

test('wear sizes display XS→2XL, numeric ascending, unknown labels kept last in order, keys untouched',()=>{
 const l=(...xs:string[])=>xs.map((label,i)=>({key:'k'+i,label}));
 assert.deepEqual(byWearSize(l('S','XS','M','2XL','XL','L')).map(v=>v.label),['XS','S','M','L','XL','2XL']);
 assert.deepEqual(byWearSize(l('L','S','M','XS')).map(v=>v.label),['XS','S','M','L']);
 assert.deepEqual(byWearSize(l('3XL','XXL','xxs','xl')).map(v=>v.label),['xxs','xl','XXL','3XL']);
 assert.deepEqual(byWearSize(l('150','FREE','130 cm','ONE','140')).map(v=>v.label),['130 cm','140','150','FREE','ONE']);
 const input=l('M','S');assert.deepEqual(byWearSize(input).map(v=>v.key),['k1','k0']);assert.deepEqual(input.map(v=>v.label),['M','S'],'input not mutated');
});
