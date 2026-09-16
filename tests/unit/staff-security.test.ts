import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {canonicalEmail,hashStaffPassword,verifyStaffPassword,validPassword} from '../../packages/auth/src/password';
import {parseAccount} from '../../packages/auth/src/accounts';
import {canManage,type StaffPrincipal} from '../../packages/auth/src/staff-auth';
import {parseRuntime} from '../../packages/auth/src/config';
test('Argon2id has independent salts and verifies only the supplied password',async()=>{
 const password=randomBytes(24).toString('base64url');const a=await hashStaffPassword(password),b=await hashStaffPassword(password);
 assert.ok(a!==b);assert.ok(a.startsWith('$argon2id$v=19$m=65536,t=3,p=1$'));assert.ok(await verifyStaffPassword({hash:a,password}));assert.equal(await verifyStaffPassword({hash:a,password:password+'x'}),false);assert.equal(await verifyStaffPassword({hash:'invalid',password}),false);
});
test('canonical email is case/outer-space stable; password policy adds no composition rules',()=>{
 assert.equal(canonicalEmail(' Synthetic-Staff@Example.Invalid '),'synthetic-staff@example.invalid');assert.throws(()=>canonicalEmail('invalid'));assert.equal(validPassword('long pass phrase without symbols'),true);assert.equal(validPassword('short'),false);assert.equal(validPassword('x'.repeat(129)),false);
});
test('role, permission and ALL scope are independently required for staff management',()=>{
 const principal:StaffPrincipal={subject:'synthetic',role:'ADMIN',scope:'ALL',permissions:['STAFF_MANAGE'],storeIds:['MOUNTAIN_BASE','ONSEN_BASE'],revision:1};
 assert.ok(canManage(principal));assert.equal(canManage({...principal,role:'STAFF'}),false);assert.equal(canManage({...principal,permissions:[]}),false);assert.equal(canManage({...principal,scope:'ASSIGNED'}),false);
});
test('staff input accepts explicit implemented operations permissions but rejects unknown authority or forged subject',()=>{
 const input={displayName:'Synthetic',active:true,role:'STAFF',scope:'ASSIGNED',storeIds:['MOUNTAIN_BASE'],permissions:{},email:'synthetic@example.invalid',password:'synthetic test-only phrase'};
 assert.ok(parseAccount(input,true));assert.deepEqual(parseAccount({...input,permissions:{REFUND_OVERRIDE:true,RENTAL_AMEND:true,INVENTORY_RECONCILE:true}},true).permissions,{REFUND_OVERRIDE:true,RENTAL_AMEND:true,INVENTORY_RECONCILE:true});assert.ok(parseAccount({...input,role:"ADMIN",scope:"ALL",permissions:{QUOTE_VIEW:true,QUOTE_CREATE:true,PRICE_EDIT:true}},true));for(const extra of [{subject:'spoof'},{permissions:{REFUND_ADMIN:true}},{permissions:{STAFF_MANAGE:true}},{storeIds:['UNKNOWN']},{storeIds:[]}])assert.throws(()=>parseAccount({...input,...extra},true));
});
test('ordinary runtime without owned development connection fails closed and cannot attach a remote DB',()=>{
 assert.equal(parseRuntime(undefined),null);assert.throws(()=>parseRuntime(JSON.stringify({origin:'https://production.invalid'})),/INVALID_DEVELOPMENT_RUNTIME/);
});
