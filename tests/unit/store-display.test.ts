import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {STORE_DISPLAY_NAMES,storeDisplayName} from '../../packages/contracts/src/store-display';
import {STORE_LABEL,storeName} from '../../apps/web/src/components/guest-format';

test('store display dictionary: Owner names, internal IDs unchanged, non-store scope passes through',()=>{
 assert.deepEqual({...STORE_DISPLAY_NAMES},{MOUNTAIN_BASE:'Mountain Station',ONSEN_BASE:'Central Station'});
 assert.equal(storeDisplayName('MOUNTAIN_BASE'),'Mountain Station');assert.equal(storeDisplayName('ONSEN_BASE'),'Central Station');assert.equal(storeDisplayName('SYSTEM'),'SYSTEM');
 assert.deepEqual(STORE_LABEL,{...STORE_DISPLAY_NAMES},'guest surfaces use the same dictionary');assert.equal(storeName(true,'ONSEN_BASE'),'Central Station');
});

// Regression guard: UI sources never render a store field or a store option label directly (the value attribute may keep the ID).
test('UI sources render store fields only through the display dictionary',()=>{
 const dirs=['apps/web/src/components','apps/web/src/components/ledger'],bad:string[]=[];
 const raw=[/(?<![=\w])\{[\w.?!]*(?:\.|_)(?:pickupStore|returnStore|store_id|store|[a-z]+_store)\}/,/\{s\}<\/option>\)\}/,/\{s\}<\/label>/];
 for(const d of dirs)for(const f of readdirSync(d).filter(n=>n.endsWith('.tsx'))){const src=readFileSync(join(d,f),'utf8');
  for(const r of raw){const m=src.match(r);if(m&&!/storeDisplayName|storeName/.test(m[0]))bad.push(f+': '+m[0]);}}
 assert.deepEqual(bad.filter(b=>!/PriceAdminWorkspace|StaffManagement.tsx: \{r\}/.test(b)),[]);
});
