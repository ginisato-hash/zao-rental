import {randomUUID} from 'node:crypto';
import Ajv from 'ajv';
import type {Pool,PoolClient} from 'pg';
import {LedgerError,type StoreId} from '../../contracts/src/ledger';
import {hashStaffPassword,canonicalEmail} from './password';
import {canManage,loadStaff,type StaffPrincipal,type StaffRole,type Permission} from './staff-auth';
import schemas from './staff-input.schema.json';
export type AccountSettings={displayName:string;active:boolean;role:StaffRole;scope:'ALL'|'ASSIGNED';storeIds:StoreId[];permissions:Partial<Record<Permission,boolean>>};
export type NewAccount=AccountSettings&{email:string;password:string};
const ajv=new Ajv({strict:true});const createValidator=ajv.compile(schemas.create),updateValidator=ajv.compile(schemas.update);
export function parseAccount(value:unknown,create:boolean){if(!(create?createValidator:updateValidator)(value))throw new LedgerError('INVALID_INPUT',422);const v=value as NewAccount;if(create){try{canonicalEmail(v.email);}catch{throw new LedgerError('INVALID_INPUT',422);}}if(v.scope==='ASSIGNED'&&!v.storeIds.length)throw new LedgerError('STORE_SCOPE_REQUIRED',422);if(v.permissions.STAFF_MANAGE&&v.role!=='ADMIN')throw new LedgerError('INVALID_INPUT',422);return v;}
export async function insertAccount(client:PoolClient,input:NewAccount,actor:string|null):Promise<string>{
 const value=parseAccount(input,true);const email=canonicalEmail(value.email);const passwordHash=await hashStaffPassword(value.password);const id=randomUUID();
 await client.query("SELECT set_config('zao.staff_actor',$1,true)",[actor??'development-bootstrap']);
 await client.query('INSERT INTO auth_user(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$2,$3,false,now(),now())',[id,value.displayName,email]);
 await client.query(`INSERT INTO auth_account(id,"accountId","providerId","userId",password,"createdAt","updatedAt") VALUES($1,$2,'credential',$2,$3,now(),now())`,[randomUUID(),id,passwordHash]);
 await client.query('INSERT INTO staff_members(id,active,role,scope) VALUES($1,$2,$3,$4)',[id,value.active,value.role,value.scope]);
 await replaceAccess(client,id,value);return id;
}
async function replaceAccess(client:PoolClient,id:string,value:AccountSettings){
 await client.query('DELETE FROM staff_store_access WHERE staff_id=$1',[id]);
 for(const store of value.storeIds)await client.query('INSERT INTO staff_store_access VALUES($1,$2)',[id,store]);
 await client.query('DELETE FROM staff_permission_overrides WHERE staff_id=$1',[id]);
 for(const [permission,allowed] of Object.entries(value.permissions))await client.query('INSERT INTO staff_permission_overrides VALUES($1,$2,$3)',[id,permission,allowed]);
}
export async function listAccounts(pool:Pool,principal:StaffPrincipal){
 if(!canManage(principal))throw new LedgerError('FORBIDDEN',403);
 return (await pool.query(`SELECT m.id,u.email,u.name AS "displayName",m.active,m.role,m.scope,m.revision,m.last_login_at AS "lastLoginAt",
 coalesce((SELECT jsonb_agg(store_id ORDER BY store_id) FROM staff_store_access WHERE staff_id=m.id),'[]'::jsonb) AS "storeIds",
 coalesce((SELECT jsonb_object_agg(permission,allowed) FROM staff_permission_overrides WHERE staff_id=m.id),'{}'::jsonb) AS permissions
 FROM staff_members m JOIN auth_user u ON u.id=m.id ORDER BY m.created_at,m.id`)).rows;
}
export async function writeAccount(pool:Pool,principal:StaffPrincipal,id:string|undefined,raw:unknown){
 if(!canManage(principal))throw new LedgerError('FORBIDDEN',403);
 const input=parseAccount(raw,!id);if(id===principal.subject)throw new LedgerError('SELF_ACCESS_CHANGE_FORBIDDEN',403);
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  await client.query('SELECT id FROM staff_members WHERE id=$1 FOR SHARE',[principal.subject]);
  const current=await loadStaff(client,principal.subject);if(!current||!canManage(current))throw new LedgerError('FORBIDDEN',403);
  let resultId=id;
  if(!id)resultId=await insertAccount(client,input,principal.subject);
  else{
   await client.query("SELECT set_config('zao.staff_actor',$1,true)",[principal.subject]);
   const changed=await client.query('UPDATE staff_members SET active=$2,role=$3,scope=$4 WHERE id=$1 RETURNING id',[id,input.active,input.role,input.scope]);if(!changed.rowCount)throw new LedgerError('NOT_FOUND',404);
   await client.query('UPDATE auth_user SET name=$2,"updatedAt"=now() WHERE id=$1',[id,input.displayName]);await replaceAccess(client,id,input);
  }
  await client.query('COMMIT');return {id:resultId};
 }catch(error){await client.query('ROLLBACK');if((error as {code?:string}).code==='23505')throw new LedgerError('DUPLICATE_ACCOUNT',409);throw error;}finally{client.release();}
}
