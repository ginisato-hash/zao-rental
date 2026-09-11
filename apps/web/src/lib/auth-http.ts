import type {Pool,PoolClient} from 'pg';
import type {StaffAuth} from '../../../../packages/auth/src/staff-auth';
import {resolveStaff} from '../../../../packages/auth/src/staff-auth';
import {canonicalEmail} from '../../../../packages/auth/src/password';
import {readJson} from './ledger-http';
const privateHeaders={'Cache-Control':'private, no-store','Vary':'Cookie','Referrer-Policy':'no-referrer'};
async function passwordFailure(client:PoolClient,id:string){await client.query("UPDATE staff_members SET failed_login_count=failed_login_count+1,locked_until=CASE WHEN failed_login_count+1>=5 THEN now()+interval '15 minutes' ELSE NULL END WHERE id=$1",[id]);}
export function authHandler(auth:StaffAuth|null,pool:Pool|null,origin:string|null,loginPool:Pool|null){return async(request:Request)=>{
 const reply=(error:string,status:number)=>Response.json({error},{status,headers:privateHeaders});
 const path=new URL(request.url).pathname;
 const login=path==='/api/auth/sign-in/email',logout=path==='/api/auth/sign-out',change=path==='/api/auth/change-password',reset=path==='/api/auth/reset-password';
 if(!login&&!logout&&!change&&!reset)return reply('NOT_FOUND',404);
 if(request.method!=='POST')return reply('METHOD_NOT_ALLOWED',405);
 if(!auth||!pool||!origin||!loginPool)return reply('AUTHENTICATION_NOT_CONFIGURED',503);
 if(request.headers.get('origin')!==origin)return reply('ORIGIN_REJECTED',403);
 try{
  const raw=await readJson(request);if(!raw||typeof raw!=='object'||Array.isArray(raw))return reply('INVALID_INPUT',422);
  const body=raw as Record<string,unknown>;
  const allowed=login?['email','password']:change?['currentPassword','newPassword']:reset?['token','newPassword']:[];
  if(Object.keys(body).some(k=>!allowed.includes(k))||allowed.some(k=>typeof body[k]!=='string')||Object.values(body).some(v=>typeof v==='string'&&v.length>254))return reply('INVALID_INPUT',422);
  const forward=(payload:unknown,url=request.url)=>new Request(url,{method:'POST',headers:request.headers,body:JSON.stringify(payload)});
  const clean=(response:Response,ok=response.ok)=>{const headers=new Headers(privateHeaders);for(const cookie of response.headers.getSetCookie())headers.append('Set-Cookie',cookie);return Response.json(ok?{ok:true}:{error:'LOGIN_REJECTED'},{status:ok?200:response.status===429?429:401,headers});};
  if(login){
   const email=canonicalEmail(body.email);const client=await loginPool.connect();
   try{
    await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,70805))',[email]);
    const member=(await client.query('SELECT m.id,m.active,m.locked_until FROM staff_members m JOIN auth_user u ON u.id=m.id WHERE u.email=$1 FOR UPDATE OF m',[email])).rows[0];
    if(member&&(!member.active||(member.locked_until&&new Date(member.locked_until)>new Date()))){await client.query("SELECT staff_log('LOGIN_FAILED',NULL,$1)",[member.id]);await client.query('COMMIT');return reply('LOGIN_REJECTED',401);}
    const response=await auth.handler(forward({email,password:body.password,rememberMe:true}));
    if(!response.ok){const detail=await response.clone().json().catch(()=>({}));if(/^[A-Z][A-Z0-9_]{0,80}$/.test(detail.code??''))console.error('AUTH_PIPELINE_CODE '+detail.code);}
    if(response.ok&&member){
     await client.query('UPDATE staff_members SET failed_login_count=0,locked_until=NULL,last_login_at=now() WHERE id=$1',[member.id]);
     await client.query("SELECT staff_log('LOGIN_SUCCESS',$1,$1)",[member.id]);
    }else{
     if(member)await passwordFailure(client,member.id);
     await client.query("SELECT staff_log('LOGIN_FAILED',NULL,$1)",[member?.id??null]);
    }
    await client.query('COMMIT');return clean(response,response.ok&&Boolean(member));
   }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
  const session=await auth.api.getSession({headers:request.headers,query:{disableCookieCache:true,disableRefresh:true}});
  if(change){
   if(!session)return reply('AUTHENTICATION_REQUIRED',401);
   const client=await loginPool.connect();
   try{
    await client.query('BEGIN');
    // Same account key as sign-in; never trust an email or identity from this request body.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,70805))',[canonicalEmail(session.user.email)]);
    const state=await resolveStaff(auth,pool,request.headers);
    if(state.status!=='authorized'){await client.query('COMMIT');return reply('AUTHENTICATION_REQUIRED',401);}
    // Do not hold a staff row lock across the library call: its password trigger updates
    // that row through a different adapter connection. The advisory lock serializes checks.
    const member=(await client.query('SELECT locked_until FROM staff_members WHERE id=$1',[state.principal.subject])).rows[0];
    if(!member||member.locked_until&&new Date(member.locked_until)>new Date()){
     await client.query("SELECT staff_log('PASSWORD_CHANGE_FAILED',$1,$1)",[state.principal.subject]);
     await client.query('COMMIT');return reply('LOGIN_REJECTED',401);
    }
    let response=await auth.handler(forward({...body,revokeOtherSessions:false}));
    if(!response.ok){
     const detail=await response.clone().json().catch(()=>({}));
     // Invalid new-password syntax and other library failures are not password guesses.
     if(detail.code==='INVALID_PASSWORD'){
      await passwordFailure(client,state.principal.subject);
      await client.query("SELECT staff_log('PASSWORD_CHANGE_FAILED',$1,$1)",[state.principal.subject]);
     }
    }
    await client.query('COMMIT');
    // DB trigger revoked all old sessions and reset failure state. Clear the old cookie too.
    if(response.ok)response=await auth.handler(forward({},`${origin}/api/auth/sign-out`));
    return clean(response);
   }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
  const response=await auth.handler(forward(reset?body:{}));
  if(logout&&response.ok)await pool.query("SELECT staff_log('LOGOUT',$1,$1)",[session?.user.id??null]);
  return clean(response);
 }catch(error){const code=(error as {code?:string})?.code;if(/^[A-Z0-9_]{1,80}$/.test(code??''))console.error('AUTH_PIPELINE_CODE '+code);return reply('AUTHENTICATION_FAILED',400);}
};}
