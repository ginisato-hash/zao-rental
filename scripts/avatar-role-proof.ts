import assert from 'node:assert/strict';
import type {Pool} from 'pg';
/** Same negative SQL runs on an owned local cluster and the authorized hosted role.
 * Each probe rolls back even if an unexpected grant allows it. No mutation survives. */
export async function proveAvatarRole(pool:Pool){
 const a=(await pool.query(`SELECT rolsuper,rolcreatedb,rolcreaterole,rolinherit,rolreplication,rolbypassrls,
  EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid) membership FROM pg_roles r WHERE rolname=current_user`)).rows[0];
 assert.ok(a);assert.ok(Object.values(a).every(v=>v===false));
 await pool.query('SELECT id,layer,derivative_sha256 FROM avatar_current_visuals LIMIT 9');
 assert.equal((await pool.query("SELECT avatar_visual_derivative('60000000-0000-4000-8000-999999999999',repeat('0',64)) bytes")).rows[0].bytes,null);
 const cases=[
  ['workspace_raw','SELECT value FROM content_workspace'],['media_raw','SELECT bytes FROM content_media_objects'],
  ['revision_raw','SELECT payload FROM content_revision_records'],['visual_mutation',"UPDATE avatar_visuals SET state='DISABLED' WHERE false"],
  ['guest_arbitrary','SELECT * FROM guest_contexts'],['recommendation_arbitrary','SELECT * FROM recommendation_previews'],
  ['business_write',"UPDATE inventory_holds SET state='EXPIRED' WHERE false"],['ddl','CREATE TABLE public.phase6_denied_probe(id int)'],
  ['role_management','CREATE ROLE phase6_denied_probe_role'],['public_function','SELECT inventory_clock()'],
  ['visual_helper',"SELECT avatar_visual_variant_matches(NULL,NULL,NULL,NULL)"],
 ] as const;
 const results=[];
 for(const [name,sql]of cases){const c=await pool.connect();let code:string|undefined;
  try{await c.query('BEGIN');await c.query("SET LOCAL statement_timeout='5000ms';SET LOCAL lock_timeout='1500ms'");try{await c.query(sql);}catch(e){code=(e as {code?:string}).code;}}finally{await c.query('ROLLBACK');c.release();}
  assert.equal(code,'42501',name);results.push({name,sqlstate:code});
 }
 return {status:'PASS',roleFlags:'ALL_FALSE',memberships:0,allowed:['narrow_current_visuals','bounded_derivative_function'],negative:results};
}
