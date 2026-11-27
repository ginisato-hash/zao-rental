// Migration administration window for a database bootstrapped with the retained dormant administrator (production-owner-compat/3;
// Issue #47 / TD #7219973419 §2-D). A later migration that replaces an executor-owned function needs the owner to hold the executor role for the
// duration of that migration ONLY. The dormant administrator (NOLOGIN, NOINHERIT, owns nothing) is the single role that may grant it.
//
//   open  : as the dormant administrator, GRANT executor TO the owner (SET, INHERIT) and give the executor temporary CREATE on public
//           (ALTER FUNCTION ... OWNER TO needs it); every statement and the resulting posture are recorded in a hash-chained audit.
//   close : REVOKE both, then prove the owner holds no executor authority and public CREATE of the executor is gone.
//
// Never superuser, never the runtime roles; no GRANT beyond the executor; both phases are idempotent-safe (open refuses an open window,
// close refuses a closed one) and `runInMigrationWindow` always closes, also when the migration fails.
import type {Pool,PoolClient} from 'pg';
import {auditChain,type Audit} from './production-cutover';
import {dormantMigrationAdminPosture} from './production-bootstrap';

const IDENT=/^[a-z][a-z0-9_]{2,62}$/;
const qi=(v:string)=>{if(!IDENT.test(v))throw new Error('PRODUCTION_MIGRATION_WINDOW_IDENTIFIER_INVALID');return '"'+v+'"';};
export type WindowRoles={admin:string;executor:string;custody:string};
export type WindowState={open:boolean;ownerMembershipOnExecutor:number;executorCreateOnPublic:boolean};

export async function windowState(c:Pool|PoolClient,roles:WindowRoles):Promise<WindowState>{
 const r=(await c.query(`SELECT (SELECT count(*)::int FROM pg_auth_members WHERE roleid=$1::regrole AND member=session_user::regrole) m,
  has_schema_privilege($1,'public','CREATE') c`,[roles.executor])).rows[0];
 return{open:r.m>0,ownerMembershipOnExecutor:r.m,executorCreateOnPublic:r.c};
}
async function assertPosture(c:Pool|PoolClient,roles:WindowRoles){
 const owner=(await c.query('SELECT session_user u')).rows[0].u as string;
 const p=await dormantMigrationAdminPosture(c,roles.admin,roles.executor,roles.custody,owner);
 if(!p.ok)throw new Error('PRODUCTION_MIGRATION_WINDOW_ADMIN_POSTURE');
}
export async function openMigrationWindow(owner:Pool,roles:WindowRoles,audit:ReturnType<typeof auditChain>=auditChain()){
 const c=await owner.connect();
 try{
  if((await windowState(c,roles)).open)throw new Error('PRODUCTION_MIGRATION_WINDOW_ALREADY_OPEN');
  await assertPosture(c,roles);
  await c.query('BEGIN READ WRITE');
  await c.query("SET LOCAL lock_timeout='1500ms'");
  await c.query(`SET LOCAL ROLE ${qi(roles.admin)}`);
  await c.query(`GRANT ${qi(roles.executor)} TO SESSION_USER WITH SET TRUE, INHERIT TRUE`);
  await c.query('RESET ROLE');
  await c.query(`GRANT CREATE ON SCHEMA public TO ${qi(roles.executor)}`);
  const s=await windowState(c,roles);
  if(!s.open||!s.executorCreateOnPublic)throw new Error('PRODUCTION_MIGRATION_WINDOW_OPEN_UNPROVEN');
  await c.query('COMMIT');
  audit.add('window-open',{...s});
  return{state:s,audit:audit.entries as Audit[]};
 }catch(e){await c.query('ROLLBACK').catch(()=>undefined);throw e;}finally{c.release();}
}
export async function closeMigrationWindow(owner:Pool,roles:WindowRoles,audit:ReturnType<typeof auditChain>=auditChain()){
 const c=await owner.connect();
 try{
  await c.query('BEGIN READ WRITE');
  await c.query("SET LOCAL lock_timeout='1500ms'");
  await c.query(`REVOKE CREATE ON SCHEMA public FROM ${qi(roles.executor)}`);
  await c.query(`SET LOCAL ROLE ${qi(roles.admin)}`);
  await c.query(`REVOKE ${qi(roles.executor)} FROM SESSION_USER`);
  await c.query('RESET ROLE');
  const s=await windowState(c,roles);
  if(s.open||s.executorCreateOnPublic)throw new Error('PRODUCTION_MIGRATION_WINDOW_CLOSE_UNPROVEN');
  await assertPosture(c,roles);
  await c.query('COMMIT');
  audit.add('window-close',{...s});
  return{state:s,audit:audit.entries as Audit[]};
 }catch(e){await c.query('ROLLBACK').catch(()=>undefined);throw e;}finally{c.release();}
}
/** Opens the window, runs the migration statements on one connection as the owner, and closes the window whatever happens. */
export async function runInMigrationWindow(owner:Pool,roles:WindowRoles,migrate:(c:PoolClient)=>Promise<void>,audit:ReturnType<typeof auditChain>=auditChain()){
 await openMigrationWindow(owner,roles,audit);
 let failure:unknown;
 const c=await owner.connect();
 try{await c.query('BEGIN READ WRITE');await migrate(c);await c.query('COMMIT');audit.add('migration-applied',{});}
 catch(e){failure=e;await c.query('ROLLBACK').catch(()=>undefined);audit.add('migration-failed',{});}
 finally{c.release();}
 await closeMigrationWindow(owner,roles,audit);
 if(failure)throw failure;
 return{audit:audit.entries as Audit[],chainValid:audit.verify()};
}
