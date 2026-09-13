import {randomBytes} from 'node:crypto';
import {Pool} from 'pg';
import {trackPoolLifecycle} from './pool-lifecycle';
import type {Connection} from '../packages/auth/src/config';
export async function provisionContentRole(owner:Pool,identity:{namespace:string;database:string;dbPort:number}){
 if(!/^zr_[a-f0-9]{12}$/.test(identity.namespace)||identity.namespace!==identity.database)throw new Error('INVALID_OWNED_DATABASE');
 const connections:Connection[]=[];
 for(const suffix of ['content','content_read']){const user=identity.namespace+'_'+suffix,password=randomBytes(24).toString('hex');await owner.query(`CREATE ROLE ${user} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`);await owner.query(`GRANT CONNECT ON DATABASE ${identity.database} TO ${user}`);await owner.query(`GRANT USAGE ON SCHEMA public TO ${user}`);
  await owner.query(`GRANT SELECT ON content_workspace,content_model_previews,content_public_policies,ledger_models,ledger_variants,ledger_assets,content_staff_access,content_media_objects TO ${user}`);
  if(suffix==='content'){await owner.query(`GRANT INSERT,UPDATE ON content_workspace,content_model_previews,content_public_policies TO ${user}`);await owner.query(`GRANT INSERT ON content_media_objects TO ${user}`);await owner.query(`GRANT SELECT,INSERT ON content_revision_records,content_audit_records,content_outbox TO ${user}`);await owner.query(`GRANT USAGE ON SEQUENCE content_audit_records_id_seq TO ${user}`);}
  connections.push({host:'127.0.0.1',port:identity.dbPort,database:identity.database,user,password});
 }
 const contentDb=connections[0]!,contentReadDb=connections[1]!,contentPool=new Pool({...contentDb,max:4}),contentReadPool=new Pool({...contentReadDb,max:4}),a=trackPoolLifecycle(contentPool),b=trackPoolLifecycle(contentReadPool);return {contentDb,contentReadDb,contentPool,contentReadPool,async close(){await Promise.all([a(),b()]);}};
}
