import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,cp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Pool} from 'pg';
import sharp from 'sharp';
import {artworkDirectory,validateLocalArtwork,validateArtworkManifest,importLocalArtwork} from '../../scripts/avatar-artwork-local';

test('Owner local package has three approved generic derivatives with correct alpha/physical artboards',async()=>{
 const {manifest,assets}=await validateLocalArtwork();assert.equal(assets.length,3);
 assert.deepEqual(manifest.optionalLayers,{BOOT:null,JACKET:null,PANTS:null});
 for(const {entry,bounds,metadataPresent}of assets){assert.equal(entry.productionApproved,false);assert.equal(entry.approvedByOwner,true);assert.equal(entry.match,'GENERIC_REFERENCE');assert.equal(bounds.y0,0);assert.equal(bounds.y1,1999);assert.equal(metadataPresent,false);}
});
test('both appearance alpha silhouettes are identical: no body-size/eligibility encoding',async()=>{
 const {assets}=await validateLocalArtwork();
 const a=await sharp(assets[0]!.bytes).extractChannel('alpha').raw().toBuffer(),b=await sharp(assets[1]!.bytes).extractChannel('alpha').raw().toBuffer();assert.deepEqual(a,b);assert.notDeepEqual(assets[0]!.bytes,assets[1]!.bytes);
});
for(const [name,change]of [
 ['Production approval',(m:Record<string,unknown>)=>{(m.files as Record<string,unknown>[])[0]!.productionApproved=true;}],
 ['self-declared replacement rights',(m:Record<string,unknown>)=>{(m.files as Record<string,unknown>[])[0]!.rightsBasis='ARBITRARY';}],
 ['path traversal',(m:Record<string,unknown>)=>{(m.files as Record<string,unknown>[])[0]!.file='../private.webp';}],
 ['exact product promise',(m:Record<string,unknown>)=>{(m.files as Record<string,unknown>[])[2]!.match='EXACT_PROMISE';}],
] as const)test('unapproved manifest mutation fails: '+name,async()=>{const m=JSON.parse(await readFile(artworkDirectory+'/manifest.json','utf8')) as Record<string,unknown>;change(m);assert.throws(()=>validateArtworkManifest(Buffer.from(JSON.stringify(m))),/ARTWORK_MANIFEST_NOT_APPROVED/);});
test('altered derivative bytes cannot retain original approval or import',async()=>{
 const temp=await mkdtemp(join(tmpdir(),'zao-artwork-test-'));
 try{await cp(artworkDirectory,temp,{recursive:true});const file=join(temp,'appearance-1.webp'),b=await readFile(file);b[b.length-1]=b[b.length-1]!^1;await writeFile(file,b);await assert.rejects(validateLocalArtwork(temp),/ARTWORK_BYTES_INVALID/);}finally{await rm(temp,{recursive:true,force:true});}
});
test('hosted/unowned connection is rejected before any pool connection',async()=>{
 const pool=new Pool({host:'example.invalid',port:5432,database:'foreign',user:'foreign'});let connected=false;pool.on('connect',()=>{connected=true;});
 try{await assert.rejects(importLocalArtwork(pool),/ARTWORK_OWNED_LOOPBACK_REQUIRED/);assert.equal(connected,false);}finally{await pool.end();}
});
