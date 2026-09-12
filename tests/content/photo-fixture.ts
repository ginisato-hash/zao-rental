import {mkdir,writeFile,readFile,lstat} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {FileFixture,fixturePath} from './file-fixture';
import type {PhotoJobStore,PhotoJob} from '../../packages/core/src/content/photo-job';
export class PhotoFileFixture implements PhotoJobStore{
 readonly file:FileFixture;readonly objectDirectory:string;
 constructor(namespace:string){this.file=new FileFixture(namespace);this.objectDirectory=fixturePath(namespace)+'.media';}
 transaction<T>(fn:(jobs:Record<string,PhotoJob>)=>Promise<T>){return this.file.edit(async r=>fn(r.photoJobs??={}));}
 objectPath(sha:string){if(!/^[a-f0-9]{64}$/.test(sha))throw new Error('OBJECT_KEY');return resolve(this.objectDirectory,sha);}
 async putPrivateObject(sha:string,bytes:Buffer){if(createHash('sha256').update(bytes).digest('hex')!==sha)throw new Error('OBJECT_HASH');const path=this.objectPath(sha);await mkdir(dirname(path),{recursive:true,mode:0o700});if((await lstat(dirname(path))).isSymbolicLink())throw new Error('OBJECT_DIRECTORY');try{await writeFile(path,bytes,{flag:'wx',mode:0o600});}catch(e){if((e as {code?:string}).code!=='EEXIST')throw e;if((await lstat(path)).isSymbolicLink()||!(await readFile(path)).equals(bytes))throw new Error('OBJECT_COLLISION');}}
 async readDerivative(sha:string){const path=this.objectPath(sha);if((await lstat(path)).isSymbolicLink())throw new Error('OBJECT_LINK');const b=await readFile(path);if(createHash('sha256').update(b).digest('hex')!==sha)throw new Error('OBJECT_CORRUPT');return b;}
}
