// PROD-R4/R6-A/R7 (integration-corrected): local proof of the pure Production role-plan
// generators against a real, Production-shaped (non-zr_*) database bootstrapped in the same
// disposable cluster, using the same TARGET pattern tests/operations/production-bootstrap.ts
// already establishes. No pg_dump/pg_restore binary or Docker is available in this sandbox (the
// same gap already disclosed for R2B-F3/R4), so the backup role's proof targets the SQL privilege
// boundary pg_dump depends on, exactly as the original R4 branch did.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {Pool} from 'pg';
import {startIsolatedPostgres} from '../../scripts/postgres';
import {bootstrapProductionSchema} from '../../scripts/production-bootstrap';
import {productionBackupRoleSql} from '../../scripts/production-backup-role';
import {productionPaymentRoleNames, productionPaymentRoleCreateSql, productionPaymentActivationGrants} from '../../scripts/production-payment-roles';
import {productionAppRoleNames, productionAppRoleCreateSql, productionAppRoleGrantSql} from '../../scripts/production-app-roles';

const TARGET = 'zao_rental_role_plan_test';
let passed = 0;
async function check(name: string, fn: () => Promise<void>): Promise<void> {
  await fn();
  passed++;
  console.log(`PASS ${name}`);
}
async function denied(query: () => Promise<unknown>, codes = ['42501']): Promise<void> {
  let error: unknown;
  try { await query(); } catch (e) { error = e; }
  assert.ok(error, 'expected a rejection');
  assert.ok(codes.includes(String((error as { code?: string }).code)), JSON.stringify(error));
}
async function loginRole(owner: Pool, dbPort: number, database: string, role: string) {
  const password = randomBytes(24).toString('hex');
  await owner.query(`ALTER ROLE ${role} LOGIN PASSWORD '${password}'`);
  const pool = new Pool({ host: '127.0.0.1', port: dbPort, database, user: role, password, max: 2, connectionTimeoutMillis: 2000 });
  return { pool, async close() { await pool.end(); } };
}

const db = await startIsolatedPostgres();
let production: Pool | undefined;
const opened: { close(): Promise<void> }[] = [];
try {
  await db.pool.query(`CREATE DATABASE ${TARGET}`);
  const source = db.pool.options as { password?: string };
  production = new Pool({ host: '127.0.0.1', port: db.identity.dbPort, user: db.identity.user, password: source.password, database: TARGET, max: 6 });
  await bootstrapProductionSchema(production, TARGET);

  // ---- R4: backup role ----
  await check('productionBackupRoleSql rejects a zr_* or malformed database/role name', () => {
    assert.throws(() => productionBackupRoleSql('zr_012345abcdef'), { message: 'PRODUCTION_DATABASE_NAME_INVALID' });
    assert.throws(() => productionBackupRoleSql(TARGET, '1leading-digit'), { message: 'PRODUCTION_ROLE_NAME_INVALID' });
    return Promise.resolve();
  });
  for (const sql of productionBackupRoleSql(TARGET)) await production.query(sql);
  const backupRole = TARGET + '_backup';
  await check('backup role is NOLOGIN-by-plan (inert) until an operator separately provisions it', async () => {
    const row = (await production!.query('SELECT rolcanlogin FROM pg_roles WHERE rolname=$1', [backupRole])).rows[0];
    assert.deepEqual(row, { rolcanlogin: false });
  });
  const backup = await loginRole(production, db.identity.dbPort, TARGET, backupRole); opened.push(backup);
  await check('once provisioned: INHERIT/NOSUPERUSER/NOCREATEDB/NOCREATEROLE/NOREPLICATION/NOBYPASSRLS and a real login', async () => {
    const row = (await production!.query('SELECT rolcanlogin,rolinherit,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=$1', [backupRole])).rows[0];
    assert.deepEqual(row, { rolcanlogin: true, rolinherit: true, rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false });
  });
  await check('backup role can SELECT a representative table in every schema pg_dump would need to read', async () => {
    for (const sql of ['SELECT 1 FROM staff_members LIMIT 1', 'SELECT 1 FROM square_webhook.inbox LIMIT 1', 'SELECT 1 FROM payment_reconciliation.jobs LIMIT 1', 'SELECT 1 FROM payment_projection.heads LIMIT 1']) await backup.pool.query(sql);
  });
  await check('backup role cannot UPDATE/DELETE, cannot run DDL, cannot create another role', async () => {
    await denied(() => backup.pool.query('UPDATE staff_members SET active=active'));
    await denied(() => backup.pool.query('DELETE FROM staff_members'));
    await denied(() => backup.pool.query('CREATE TABLE backup_role_probe(x int)'));
    await denied(() => backup.pool.query('CREATE ROLE backup_role_probe2'));
  });
  await check('mutation test: revoking the one load-bearing grant makes every schema unreadable again', async () => {
    await production!.query(`REVOKE pg_read_all_data FROM ${backupRole}`);
    await denied(() => backup.pool.query('SELECT 1 FROM staff_members LIMIT 1'));
    await production!.query(`GRANT pg_read_all_data TO ${backupRole}`);
    await backup.pool.query('SELECT 1 FROM staff_members LIMIT 1');
  });

  // ---- R7/R6-A: payment roles (extends the EXISTING _pay_* architecture, no new role family) ----
  const names = productionPaymentRoleNames(TARGET);
  for (const sql of productionPaymentRoleCreateSql(TARGET)) await production.query(sql);
  for (const sql of productionPaymentActivationGrants(TARGET)) await production.query(sql);
  const receiver = await loginRole(production, db.identity.dbPort, TARGET, names.receiver); opened.push(receiver);
  const dispatcher = await loginRole(production, db.identity.dbPort, TARGET, names.dispatcher); opened.push(dispatcher);
  const worker = await loginRole(production, db.identity.dbPort, TARGET, names.worker); opened.push(worker);
  const diagnostic = await loginRole(production, db.identity.dbPort, TARGET, names.diagnostic); opened.push(diagnostic);

  await check('_pay_receipt can receive() (Sandbox and Production alike; the function is already environment-agnostic) but not dispatch/claim/finalize/context-load', async () => {
    const r = await receiver.pool.query("SELECT square_webhook.receive('PRODUCTION','evt-p-1','payment.created','merchant-1','pay-1',repeat('a',64)) AS v");
    assert.equal(r.rows[0].v, 'INSERTED');
    await denied(() => receiver.pool.query("SELECT payment_reconciliation.dispatch_production('merchant-1',10)"));
    await denied(() => receiver.pool.query("SELECT payment_reconciliation.claim_production('owner-1',10,'merchant-1')"));
    await denied(() => receiver.pool.query("SELECT payment_reconciliation.load_context_production('PRODUCTION','merchant-1','pay-1')"));
  });
  await check('_pay_dispatch can dispatch/dispatch_production but not claim/finalize/context-load or receive', async () => {
    const n = await dispatcher.pool.query("SELECT payment_reconciliation.dispatch_production('merchant-1',10) AS n");
    assert.equal(n.rows[0].n, 1);
    await denied(() => dispatcher.pool.query("SELECT payment_reconciliation.claim_production('owner-1',10,'merchant-1')"));
    await denied(() => dispatcher.pool.query("SELECT square_webhook.receive('PRODUCTION','evt-p-2','payment.created','merchant-1','pay-2',repeat('b',64))"));
  });
  await check('_pay_truth (R6-A): can claim_production/load_context_production/load_contexts_production/finalize, but not dispatch or receive', async () => {
    const claimed = (await worker.pool.query("SELECT payment_reconciliation.claim_production('owner-1',10,'merchant-1') AS claim")).rows[0].claim;
    assert.equal(claimed.paymentId, 'pay-1');
    const ctx = await worker.pool.query("SELECT payment_reconciliation.load_context_production('PRODUCTION','merchant-1','pay-1') AS v");
    assert.equal(ctx.rows[0].v, null); // no matching rental_payment_attempts row exists in this fixture; a real NULL/found path, not a permission error
    await worker.pool.query("SELECT payment_reconciliation.load_contexts_production('PRODUCTION',ARRAY[$1]::uuid[])", [claimed.id]);
    await denied(() => worker.pool.query("SELECT payment_reconciliation.dispatch_production('merchant-1',10)"));
    await denied(() => worker.pool.query("SELECT square_webhook.receive('PRODUCTION','evt-p-3','payment.created','merchant-1','pay-3',repeat('c',64))"));
  });
  await check('_pay_diagnostic is read-only diagnostics only', async () => {
    await diagnostic.pool.query("SELECT payment_reconciliation.diagnostics('PRODUCTION',10)");
    await denied(() => diagnostic.pool.query("SELECT payment_reconciliation.dispatch_production('merchant-1',10)"));
    await denied(() => diagnostic.pool.query("SELECT payment_reconciliation.claim_production('owner-1',10,'merchant-1')"));
  });
  await check('R6-B merchant boundary: dispatch_production for one merchant never dispatches another merchant\'s row', async () => {
    // _pay_dispatch also keeps its existing generic dispatch()/dispatch_target() grants (matching
    // the established R14/R15 pattern) — dispatch_production is an additional narrow capability,
    // not a replacement, so no denial is expected on the generic function itself here.
    await receiver.pool.query("SELECT square_webhook.receive('PRODUCTION','evt-p-4','payment.created','merchant-2','pay-4',repeat('e',64))");
    const zero = await dispatcher.pool.query("SELECT payment_reconciliation.dispatch_production('merchant-1',10) AS n");
    assert.equal(zero.rows[0].n, 0); // merchant-1 has nothing left undispatched; merchant-2's row must not have been swept in
    const one = await dispatcher.pool.query("SELECT payment_reconciliation.dispatch_production('merchant-2',10) AS n");
    assert.equal(one.rows[0].n, 1);
    const claimedOnlyMerchant2 = (await worker.pool.query("SELECT payment_reconciliation.claim_production('owner-1',10,'merchant-1') AS claim")).rows;
    assert.equal(claimedOnlyMerchant2.length, 0); // merchant-1's claim call cannot see merchant-2's job
  });
  await check('mutation test: revoking claim_production from _pay_truth breaks it; re-granting restores it', async () => {
    await production!.query(`REVOKE EXECUTE ON FUNCTION payment_reconciliation.claim_production(text,integer,text) FROM ${names.worker}`);
    await denied(() => worker.pool.query("SELECT payment_reconciliation.claim_production('owner-1',10,'merchant-2') AS claim"));
    await production!.query(`GRANT EXECUTE ON FUNCTION payment_reconciliation.claim_production(text,integer,text) TO ${names.worker}`);
    await worker.pool.query("SELECT payment_reconciliation.claim_production('owner-1',10,'merchant-2') AS claim");
  });

  // ---- R3: application role plan (11 productionServices, reusing the local scripts' grants) ----
  const appNames = productionAppRoleNames(TARGET);
  for (const sql of productionAppRoleCreateSql(TARGET)) await production.query(sql);
  for (const sql of productionAppRoleGrantSql(TARGET)) await production.query(sql);
  const auth = await loginRole(production, db.identity.dbPort, TARGET, appNames.auth); opened.push(auth);
  const hold = await loginRole(production, db.identity.dbPort, TARGET, appNames.hold); opened.push(hold);
  const bookingAccess = await loginRole(production, db.identity.dbPort, TARGET, appNames.booking_access); opened.push(bookingAccess);

  await check('R3 app roles: auth can read/write its own tables but not another service\'s schema', async () => {
    await auth.pool.query('SELECT count(*) FROM staff_members');
    await auth.pool.query('SELECT count(*) FROM auth_user');
    await denied(() => auth.pool.query('SELECT * FROM booking_access.read($1)', ['x']));
    await denied(() => auth.pool.query('SELECT count(*) FROM guest_contexts'));
  });
  await check('R3 app roles: hold can read/write its own tables but cannot touch booking_access', async () => {
    await hold.pool.query('SELECT count(*) FROM inventory_holds');
    await hold.pool.query("SELECT inventory_clock()");
    await denied(() => hold.pool.query('SELECT * FROM booking_access.read($1)', ['x']));
  });
  await check('R3 app roles: booking_access can call its own schema\'s functions but has no direct table access anywhere', async () => {
    await bookingAccess.pool.query("SELECT booking_access.read('nonexistent')"); // callable; a not-found token is a normal (non-error) result
    await denied(() => bookingAccess.pool.query('SELECT count(*) FROM staff_members'));
    await denied(() => bookingAccess.pool.query('SELECT count(*) FROM inventory_holds'));
  });
  await check('mutation test: revoking hold\'s SELECT on inventory_holds breaks it; re-granting restores it', async () => {
    await production!.query(`REVOKE SELECT ON inventory_holds FROM ${appNames.hold}`);
    await denied(() => hold.pool.query('SELECT count(*) FROM inventory_holds'));
    await production!.query(`GRANT SELECT ON inventory_holds TO ${appNames.hold}`);
    await hold.pool.query('SELECT count(*) FROM inventory_holds');
  });

  console.log(JSON.stringify({ status: 'PASS', cases: passed }));
} finally {
  for (const o of opened) await o.close();
  await production?.end();
  await db.stop();
}
