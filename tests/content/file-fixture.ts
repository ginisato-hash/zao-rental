import {mkdir,readFile,writeFile,rename,open,unlink,rm,access} from 'node:fs/promises';
import {resolve} from 'node:path';
const fixtureRoot=process.env.ZAO_TEST_CONTENT_FIXTURE_ROOT??resolve('.local/content-fixtures');
import {randomUUID} from 'node:crypto';
import type {ContentRepository,ContentWorkflowState,ContentPermission} from '../../packages/core/src/content/workflow';
import type {CatalogFact,planCatalogSources} from '../../packages/core/src/content/catalog-source';
import type {PhotoJob} from '../../packages/core/src/content/photo-job';
export type FixtureRecord={catalogFacts?:CatalogFact[];catalogSources?:Record<string,ReturnType<typeof planCatalogSources>[number]>;photoJobs?:Record<string,PhotoJob>;schema:'PRIVATE_CONTENT_FIXTURE_V1';namespace:string;grants:Record<string,ContentPermission[]>;state:ContentWorkflowState};
export function fixturePath(namespace:string){if(!/^zr_[0-9a-f]{12}$/.test(namespace))throw new Error('FIXTURE_NAMESPACE');return resolve(fixtureRoot,namespace+'.json');}
// A local file fixture, not a production content DB or a power to publish. All data is
// synthetic. Cross-request/process locking is bounded and never steals a stale lock.
export class FileFixture implements ContentRepository{
 constructor(readonly namespace:string){}
 async read(){const x=JSON.parse(await readFile(fixturePath(this.namespace),'utf8')) as FixtureRecord;if(x.schema!=='PRIVATE_CONTENT_FIXTURE_V1'||x.namespace!==this.namespace)throw new Error('FIXTURE_MISMATCH');return x;}
 async transaction<T>(fn:(state:ContentWorkflowState)=>Promise<T>){return this.edit(async record=>fn(record.state));}
 async edit<T>(fn:(record:FixtureRecord)=>Promise<T>){const path=fixturePath(this.namespace);let lock:Awaited<ReturnType<typeof open>>|undefined;
  for(let i=0;i<100;i++){try{lock=await open(path+'.lock','wx',0o600);break;}catch(e){if((e as {code?:string}).code!=='EEXIST')throw e;await new Promise(r=>setTimeout(r,5));}}
  if(!lock)throw new Error('FIXTURE_LOCKED');const temp=path+'.'+randomUUID()+'.tmp';
  try{const record=await this.read(),result=await fn(record);await writeFile(temp,JSON.stringify(record),{flag:'wx',mode:0o600});await rename(temp,path);return result;}finally{try{await unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}finally{try{await lock.close();}finally{await unlink(path+'.lock');}}}
 }
}
export async function seedContentFixture(namespace:string,subject:string){const path=fixturePath(namespace);try{await access(path+'.media');throw new Error('FIXTURE_MEDIA_EXISTS');}catch(e){if((e as {code?:string}).code!=='ENOENT')throw e;}await mkdir(fixtureRoot,{recursive:true});const record:FixtureRecord={schema:'PRIVATE_CONTENT_FIXTURE_V1',namespace,catalogFacts:['SKI','SNOWBOARD'].map((sport,n)=>({modelId:n?'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb':'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',brand:'SYNTHETIC',modelName:n?'Board Demo':'Ski Demo',sport:sport as 'SKI'|'SNOWBOARD',season:'2026/27',manufacturerSku:null,sourceDocument:'SYNTHETIC fixture only',sourceLocator:String(n)})),catalogSources:{},grants:{[subject]:['CONTENT_EDIT','CONTENT_BULK','CONTENT_PUBLISH']},state:{catalog:{current:null,draftIds:{'SKI/ja':'ski-j1','BOARD/ja':'board-j1'},commercialRevisions:{SKI:'SYNTHETIC-TERMS1',BOARD:'SYNTHETIC-TERMS1'},revisions:['SKI','BOARD'].map((offerCode,n)=>({id:n?'board-j1':'ski-j1',offerCode,locale:'ja',content:{title:'合成 '+offerCode,summary:'旧説明',fit_note:'店頭確認'},sourceRevision:null,translationApproved:true,mediaIds:['synthetic-image'],commercialRevision:'SYNTHETIC-TERMS1'})),media:[{id:'synthetic-image',processed:true,rightsConfirmed:true,rightsUntil:'2099-01-01T00:00:00Z',alt:'SYNTHETIC fixture image',immutableSha256:'1'.repeat(64),internalOnly:false}],releases:[]},plans:{},requests:{},audit:[],outbox:[]}};await writeFile(path,JSON.stringify(record),{flag:'wx',mode:0o600});}
export async function removeContentFixture(namespace:string){await rm(fixturePath(namespace)+'.media',{recursive:true,force:true});await unlink(fixturePath(namespace)).catch(e=>{if(e.code!=='ENOENT')throw e;});}
