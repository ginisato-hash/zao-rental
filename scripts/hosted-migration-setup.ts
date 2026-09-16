import {createHash} from 'node:crypto';
import type {Pool} from 'pg';

/** The original custody migrations assumed a local superuser. PostgreSQL requires
 * SET ROLE + destination CREATE rights for their ownership transfers. Grant these
 * only for newly created development NOLOGIN roles, inside migrate()'s transaction,
 * and remove them before COMMIT. No migration bytes or final runtime policy change.
 */
export function administrativeMigrationPool(owner:Pool,database:string,sources:readonly {id:string;sha256:string}[]):Pool{
  if(!/^zr_[a-f0-9]{12}$/.test(database))throw Error('R15_SETUP_DATABASE_REQUIRED');
  const ids=new Map(sources.map(s=>[s.sha256,s.id]));
  return {
    options:owner.options,query:owner.query.bind(owner),
    async connect(){
      const c=await owner.connect();let transferSetup=false;
      return {
        release:(bad?:boolean)=>c.release(bad),
        async query(sql:string,args?:unknown[]){
          const id=ids.get(createHash('sha256').update(sql).digest('hex'));
          try{
            if(id==='0015'){
              const marker='\nCREATE SCHEMA rental_internal;';
              const cut=sql.indexOf(marker);
              if(cut<0||sql.indexOf(marker,cut+1)!==-1)throw Error('R15_CUSTODY_SOURCE_BOUNDARY_MISMATCH');
              const setup=(await c.query("SELECT current_user AS role,current_database() AS db,pg_get_userbyid(datdba)=current_user AS owner,current_setting('createrole_self_grant') AS self_grant FROM pg_database WHERE datname=current_database()")).rows[0];
              if(setup.db!==database||!setup.owner)throw Error('R15_SETUP_OWNER_REQUIRED');
              await c.query("SET LOCAL createrole_self_grant='inherit,set'");
              await c.query(sql.slice(0,cut));
              await c.query("SELECT set_config('createrole_self_grant',$1,true)",[setup.self_grant]);
              const executor=database+'_custody_executor';
              await c.query(`GRANT CREATE ON DATABASE ${database} TO ${executor}`);
              await c.query(`GRANT CREATE ON SCHEMA public TO ${executor}`);
              transferSetup=true;
              return await c.query(sql.slice(cut));
            }
            if(sql==='COMMIT'&&transferSetup)throw Error('R15_SETUP_CLEANUP_REQUIRED');
            const result=await c.query(sql,args);
            if(id==='0017'&&transferSetup){
              const executor=database+'_custody_executor',app=database+'_custody';
              await c.query(`REVOKE CREATE ON DATABASE ${database} FROM ${executor}`);
              await c.query(`REVOKE CREATE ON SCHEMA public FROM ${executor}`);
              await c.query(`REVOKE ${executor},${app} FROM CURRENT_USER`);
              transferSetup=false;
            }
            return result;
          }catch(error){
            const e=error as {code?:string;where?:string;internalQuery?:string};
            const context=e.internalQuery??e.where??sql;
            const operationClass=/ALTER\s+(SCHEMA|TABLE|FUNCTION)/i.test(context)?'ALTER':/GRANT\s/i.test(context)?'GRANT':/REVOKE\s/i.test(context)?'REVOKE':id?'MIGRATION':'TRANSACTION';
            throw Object.assign(new Error('R15_MIGRATION_FAILED'),{migrationId:id??null,code:/^[0-9A-Z]{5}$/.test(e.code??'')?e.code:null,operationClass});
          }
        },
      };
    },
  } as unknown as Pool;
}
