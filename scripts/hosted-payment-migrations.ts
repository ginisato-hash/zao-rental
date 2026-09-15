import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import type {Pool} from 'pg';
import {migrate,migrationPlan} from '../packages/db/src/index';
import {validateHostedIdentity,type HostedDevelopmentIdentity} from './hosted-payment-activation';
export async function verifyR15MigrationSources(root=process.cwd()){
 const expected=JSON.parse(await readFile(resolve(root,'docs/execution/p6/r14-evidence/migration-hashes.json'),'utf8')) as {id:string;file:string;sha256:string}[];
 if(expected.length!==29||migrationPlan.length!==29)throw new Error('R15_MIGRATION_RANGE_MISMATCH');
 const result=[];
 for(let index=0;index<29;index++){
  const item=expected[index]!,actual=migrationPlan[index]!;
  if(item.id!==String(index+1).padStart(4,'0')||item.id!==actual.id||item.file!==actual.file||!/^\d{4}_[a-z0-9_]+\.sql$/.test(item.file))throw new Error('R15_MIGRATION_ORDER_MISMATCH');
  const sha256=createHash('sha256').update(await readFile(resolve(root,'packages/db/migrations',item.file))).digest('hex');
  if(sha256!==item.sha256)throw new Error('R15_APPLIED_MIGRATION_CHANGED');result.push({id:item.id,file:item.file,sha256});
 }
 return result;
}
/** Does not create a provider resource or fetch secrets; caller supplies the verified migration-owner pool. */
export async function migrateHostedDevelopment(owner:Pool,identity:HostedDevelopmentIdentity){
 validateHostedIdentity(identity);if(process.env.NODE_ENV==='production'||owner.options.host!==identity.hostname||owner.options.database!==identity.namespace||typeof owner.options.ssl!=='object'||owner.options.ssl.rejectUnauthorized!==true)throw new Error('R15_MIGRATION_OWNER_REQUIRED');
 const sources=await verifyR15MigrationSources();
 const actual=(await owner.query('SELECT current_database() AS name')).rows[0]?.name;if(actual!==identity.namespace)throw new Error('R15_MIGRATION_DATABASE_MISMATCH');
 await migrate(owner);return {classification:'HOSTED_SYNTHETIC_DEVELOPMENT',database:identity.namespace,sources};
}
