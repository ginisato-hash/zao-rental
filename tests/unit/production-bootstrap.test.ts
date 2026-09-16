import test from 'node:test';
import assert from 'node:assert/strict';
import {productionRequested,bootstrapProductionRuntime,productionStartupState,getProductionRuntime,installProductionBootstrap} from '../../packages/core/src/guest/production-bootstrap';
import type {ProductionRuntimeInput} from '../../packages/core/src/guest/production-runtime';
test('NODE_ENV never activates runtime; explicit missing capability fails and latches without dev/Preview fallback or retry',async()=>{
 const node=process.env.NODE_ENV,marker=process.env.ZAO_PRODUCTION_RUNTIME;
 try{Reflect.set(process.env,'NODE_ENV','production');Reflect.deleteProperty(process.env,'ZAO_PRODUCTION_RUNTIME');assert.equal(productionRequested(),false);assert.equal(await bootstrapProductionRuntime(),null);assert.equal(getProductionRuntime(),null);
  process.env.ZAO_PRODUCTION_RUNTIME='UNAPPROVED';await assert.rejects(bootstrapProductionRuntime(),{message:'FEATURE_FLAGS'});assert.deepEqual(productionStartupState(),{ready:false,stage:'FEATURE_FLAGS'});assert.throws(()=>installProductionBootstrap({} as ProductionRuntimeInput),{message:'FEATURE_FLAGS'});await assert.rejects(bootstrapProductionRuntime(),{message:'FEATURE_FLAGS'});assert.equal(getProductionRuntime(),null);
 }finally{if(node===undefined)Reflect.deleteProperty(process.env,'NODE_ENV');else Reflect.set(process.env,'NODE_ENV',node);if(marker===undefined)Reflect.deleteProperty(process.env,'ZAO_PRODUCTION_RUNTIME');else process.env.ZAO_PRODUCTION_RUNTIME=marker;}
});
