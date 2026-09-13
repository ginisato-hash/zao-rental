import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assetIdFromQr} from '../../packages/contracts/src/asset-qr';
test('equipment input accepts one immutable whole Asset ID, never reservation payload or inferred identities',()=>{const id='00000000-0000-4000-8000-000000001201';assert.equal(assetIdFromQr(' '+id+' '),id);for(const value of ['zao-rental:reservation:'+id,id+'-left',id+'-right','150 cm','unknown',null])assert.equal(assetIdFromQr(value),null);});
