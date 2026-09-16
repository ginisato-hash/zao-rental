import {betterAuth} from 'better-auth';
import type {Pool} from 'pg';
import {hashStaffPassword,verifyStaffPassword,passwordPolicy} from './password';
import type {LedgerPrincipal,StoreId} from '../../contracts/src/ledger';
export const staffRoles=['ADMIN','MANAGER','STAFF','VIEWER'] as const;
export type StaffRole=typeof staffRoles[number];
export const permissions=['INVENTORY_VIEW','INVENTORY_EDIT','STAFF_MANAGE','HOLD_VIEW','HOLD_EDIT','TRANSFER_VIEW','TRANSFER_PLAN','TRANSFER_DISPATCH','TRANSFER_RECEIVE','QUOTE_VIEW','QUOTE_CREATE','PRICE_EDIT','BOOKING_VIEW','BOOKING_CREATE','RENTAL_CHECKOUT','RENTAL_RETURN','RENTAL_AMEND','REFUND_OVERRIDE','INVENTORY_RECONCILE'] as const;
export type Permission=typeof permissions[number];
export type StaffPrincipal={subject:string;role:StaffRole;storeIds:StoreId[];scope:'ALL'|'ASSIGNED';permissions:Permission[];revision:number};
export type ResetDelivery=(payload:{token:string;email:string})=>Promise<void>;
export function createStaffAuth(pool:Pool,settings:{origin:string;secret:string;resetDelivery?:ResetDelivery}) {
 return betterAuth({
  appName:'ZAO Rental',baseURL:settings.origin,secret:settings.secret,database:pool,
  trustedOrigins:[settings.origin],logger:{disabled:true},
  emailAndPassword:{enabled:true,disableSignUp:true,autoSignIn:false,minPasswordLength:passwordPolicy.min,maxPasswordLength:passwordPolicy.max,password:{hash:hashStaffPassword,verify:verifyStaffPassword},revokeSessionsOnPasswordReset:true,resetPasswordTokenExpiresIn:900,...(settings.resetDelivery?{sendResetPassword:async({user,token})=>settings.resetDelivery!({email:user.email,token})}:{})},
  user:{modelName:'auth_user'},
  session:{modelName:'auth_session',expiresIn:8*60*60,disableSessionRefresh:true,cookieCache:{enabled:false}},
  account:{modelName:'auth_account',accountLinking:{enabled:false}},
  verification:{modelName:'auth_verification',storeIdentifier:'hashed'},
  advanced:{cookiePrefix:'zao-rental',useSecureCookies:settings.origin.startsWith('https:'),defaultCookieAttributes:{httpOnly:true,sameSite:'lax',path:'/'},disableCSRFCheck:false,disableOriginCheck:false},
  rateLimit:{enabled:true,window:60,max:100,customRules:{'/sign-in/email':{window:60,max:30}}},
  databaseHooks:{session:{create:{before:async data=>{
   const row=(await pool.query('SELECT active,locked_until FROM staff_members WHERE id=$1',[data.userId])).rows[0];
   return row?.active&&(!row.locked_until||new Date(row.locked_until)<=new Date())?{data}:false;
  }}}},
 });
}
export type StaffAuth=ReturnType<typeof createStaffAuth>;
export type StaffState = {status:'anonymous'|'unregistered'|'disabled';principal:null;stamp:null}|{status:'authorized';principal:StaffPrincipal;stamp:string};
export async function loadStaff(pool:Pick<Pool,'query'>,id:string):Promise<StaffPrincipal|null>{
 const row=(await pool.query<{id:string;active:boolean;role:StaffRole;scope:'ALL'|'ASSIGNED';revision:number}>('SELECT id,active,role,scope,revision FROM staff_members WHERE id=$1',[id])).rows[0];
 if(!row?.active)return null;
 const storeIds=(await pool.query<{store_id:StoreId}>(row.scope==='ALL'?'SELECT id AS store_id FROM ledger_stores ORDER BY id':'SELECT store_id FROM staff_store_access WHERE staff_id=$1 ORDER BY store_id',row.scope==='ALL'?[]:[id])).rows.map(r=>r.store_id);
 const allowed=(await pool.query<{permission:Permission}>(`SELECT p.permission FROM (SELECT permission,true AS allowed FROM staff_role_permissions WHERE role=$2 UNION ALL SELECT permission,allowed FROM staff_permission_overrides WHERE staff_id=$1) p GROUP BY p.permission HAVING CASE WHEN count(*) FILTER(WHERE NOT p.allowed)>0 THEN false ELSE bool_or(p.allowed) END ORDER BY p.permission`,[id,row.role])).rows.map(r=>r.permission);
 return {subject:row.id,role:row.role,scope:row.scope,permissions:allowed,storeIds,revision:row.revision};
}
export async function resolveStaff(auth:StaffAuth,pool:Pool,headers:Headers):Promise<StaffState> {
 const session=await auth.api.getSession({headers,query:{disableCookieCache:true,disableRefresh:true}});
 if(!session)return {status:'anonymous',principal:null,stamp:null};
 const principal=await loadStaff(pool,session.user.id);
 if(!principal)return {status:'disabled',principal:null,stamp:null};
 return {status:'authorized',principal,stamp:JSON.stringify([session.session.id,principal])};
}
export function ledgerPrincipal(principal:StaffPrincipal):LedgerPrincipal{return {subject:principal.subject,role:principal.permissions.includes('INVENTORY_EDIT')?'ADMIN':'STAFF',storeIds:principal.storeIds};}
export function canManage(principal:StaffPrincipal){return principal.role==='ADMIN'&&principal.scope==='ALL'&&principal.permissions.includes('STAFF_MANAGE');}
