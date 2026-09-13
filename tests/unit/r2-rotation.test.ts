import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createHash,randomBytes} from 'node:crypto';
import {R2MediaProvider} from '../../packages/core/src/content/r2-media';
test('P5 R2 rotation uses current credential for next SDK operation, never the memoized old key',async()=>{
 const account='b'.repeat(32),bucket='synthetic-p5',bytes=Buffer.from('SYNTHETIC_P5_IMAGE'),hash=createHash('sha256').update(bytes).digest('hex'),seen:string[]=[];let keyId='SYNTHETIC_FIRST';
 const secrets={SYNTHETIC_FIRST:randomBytes(32).toString('hex'),SYNTHETIC_SECOND:randomBytes(32).toString('hex')};
 const r2=new R2MediaProvider(account,bucket,async()=>({accountId:account,bucket,accessKeyId:keyId,secretAccessKey:secrets[keyId as keyof typeof secrets],expiresAt:new Date('2035-01-02'),revoked:false}),async(keys,requestId)=>({keys,requestId,completed:true}),()=>new Date('2035-01-01'),{handle:async(request:{headers:Record<string,string>})=>{
  const credential=/Credential=([^/]+)\//.exec(request.headers.authorization??'')?.[1];if(!credential||!Object.hasOwn(secrets,credential))throw new Error('SYNTHETIC_SIGNING_KEY_UNEXPECTED');seen.push(credential);
  return {response:{statusCode:200,headers:{'x-amz-meta-sha256':hash,'content-length':String(bytes.length)},body:Readable.from([bytes])}};
 }});
 try{await r2.readPrivate('private/original/sha256/'+hash);keyId='SYNTHETIC_SECOND';await r2.readPrivate('private/original/sha256/'+hash);assert.deepEqual(seen,['SYNTHETIC_FIRST','SYNTHETIC_SECOND']);}finally{r2.close();}
});
