import test from 'node:test';
import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {startIsolatedPostgres} from '../../scripts/postgres';
import {migrate} from '../../packages/db/src/index';
import {verifyR15MigrationSources} from '../../scripts/hosted-payment-migrations';
import {administrativeMigrationPool} from '../../scripts/hosted-migration-setup';

test('non-superuser migration owner: reproduce 0015 and remove temporary transfer privileges',async()=>{
  const db=await startIsolatedPostgres();let owner:Pool|undefined;
  try{
    const database=db.identity.database,name=database+'_setup',executor=database+'_custody_executor';
    await db.pool.query(`CREATE ROLE ${name} LOGIN CREATEROLE CREATEDB NOSUPERUSER PASSWORD 'FAKE_LOCAL_SETUP_ONLY'`);
    await db.pool.query(`ALTER DATABASE ${database} OWNER TO ${name}`);
    owner=new Pool({host:'127.0.0.1',port:db.identity.dbPort,database,user:name,password:'FAKE_LOCAL_SETUP_ONLY',max:2});
    await assert.rejects(migrate(owner),(error:unknown)=>{
      const e=error as {code?:string;message?:string;where?:string};
      return e.code==='42501'&&!!e.message?.includes('must be able to SET ROLE')&&!!e.where?.includes('ALTER SCHEMA');
    });
    assert.equal((await owner.query("SELECT to_regclass('foundation_migrations') IS NULL absent")).rows[0].absent,true);
    const sources=await verifyR15MigrationSources();
    await migrate(administrativeMigrationPool(owner,database,sources));
    const actual=(await owner.query('SELECT id,checksum FROM foundation_migrations ORDER BY id')).rows;
    assert.deepEqual(actual,sources.map(s=>({id:s.id,checksum:s.sha256})));
    const final=(await owner.query("SELECT has_database_privilege($1,current_database(),'CREATE') AS database_create,has_schema_privilege($1,'public','CREATE') AS public_create,pg_has_role(current_user,$1,'USAGE') AS setup_inherit,pg_has_role(current_user,$1,'SET') AS setup_set,pg_get_userbyid(nspowner)=$1 AS intended_schema_owner FROM pg_namespace WHERE nspname='rental_internal'",[executor])).rows[0];
    assert.deepEqual(final,{database_create:false,public_create:false,setup_inherit:false,setup_set:false,intended_schema_owner:true});
    const membership=(await owner.query("SELECT admin_option,inherit_option,set_option FROM pg_auth_members WHERE roleid=(SELECT oid FROM pg_roles WHERE rolname=$1) AND member=(SELECT oid FROM pg_roles WHERE rolname=current_user)",[executor])).rows;
    assert.deepEqual(membership,[{admin_option:true,inherit_option:false,set_option:false}]);
    const publicCreate=(await owner.query("SELECT count(*)::int n FROM pg_namespace n CROSS JOIN LATERAL aclexplode(n.nspacl) a WHERE n.nspname='public' AND a.grantee=0 AND a.privilege_type='CREATE'")).rows[0].n;
    assert.equal(publicCreate,0);
  }finally{await owner?.end();await db.stop();}
});
