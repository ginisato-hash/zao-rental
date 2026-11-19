import test from 'node:test';
import assert from 'node:assert/strict';
import {STAFF_NEW_ORDER_PERMISSIONS,canCreateStaffOrder,staffOrderStoresAllowed} from '../../packages/auth/src/staff-order-access';

// Issue #47 TD FB #7010252887 §3: one New order rule for buttons, page, HTTP and the draft store.
const all=[...STAFF_NEW_ORDER_PERMISSIONS];
test('New order requires every flow permission and at least one station',()=>{
 assert.equal(canCreateStaffOrder({permissions:all,storeIds:['MOUNTAIN_BASE']}),true);
 for(const missing of all)assert.equal(canCreateStaffOrder({permissions:all.filter(p=>p!==missing),storeIds:['MOUNTAIN_BASE']}),false,missing);
 assert.equal(canCreateStaffOrder({permissions:all,storeIds:[]}),false,'no station in scope');
 // The previous button rule (QUOTE_CREATE && HOLD_EDIT) alone is not enough.
 assert.equal(canCreateStaffOrder({permissions:['QUOTE_CREATE','HOLD_EDIT'],storeIds:['MOUNTAIN_BASE']}),false);
});
test('pickup and return stations must both be in scope',()=>{
 const p={storeIds:['ONSEN_BASE']};
 assert.equal(staffOrderStoresAllowed(p,['ONSEN_BASE','ONSEN_BASE']),true);
 assert.equal(staffOrderStoresAllowed(p,['MOUNTAIN_BASE','ONSEN_BASE']),false);
 assert.equal(staffOrderStoresAllowed(p,['ONSEN_BASE','MOUNTAIN_BASE']),false);
 assert.equal(staffOrderStoresAllowed(p,[undefined,'ONSEN_BASE']),false);
});
