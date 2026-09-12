import test from 'node:test';
import assert from 'node:assert/strict';
import {decodePhotoBase64} from '../../packages/core/src/content/photo-input';
test('photo transport decodes valid 9MiB and exact 10MiB without regex stack growth',()=>{
 for(const size of [9*1024*1024,10*1024*1024]){const bytes=Buffer.alloc(size,17);assert.deepEqual(decodePhotoBase64(bytes.toString('base64')),bytes);}
});
test('photo transport rejects oversized, noncanonical and malformed encodings',()=>{
 assert.throws(()=>decodePhotoBase64(Buffer.alloc(10*1024*1024+1).toString('base64')),/PHOTO_SIZE/);
 for(const input of [null,1,'','!!!!','YQ','YQ==\n','YR==','-_==','YQ==='])assert.throws(()=>decodePhotoBase64(input),/PHOTO_REQUEST/);
 assert.equal(decodePhotoBase64('YQ==').toString(),'a');
});
