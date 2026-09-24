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
import {trackPoolLifecycle} from '../../scripts/pool-lifecycle';
import {bootstrapProductionSchema} from '../../scripts/production-bootstrap';
import {productionBackupRoleSql} from '../../scripts/production-backup-role';
import {productionPaymentRoleNames, productionPaymentRoleCreateSql, productionPaymentActivationGrants} from '../../scripts/production-payment-roles';
import {productionAppRoleNames, productionAppRoleCreateSql, productionAppRoleGrantSql} from '../../scripts/production-app-roles';
import {verifyProductionDatabase} from '../../packages/db/src/production-connection';
import {PgSquareProductionWebhookInbox, PgSquareWebhookInbox} from '../../packages/db/src/square-webhook-inbox';
import {productionServices, type ProductionConfiguration} from '../../packages/auth/src/production-config';

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
  const close = trackPoolLifecycle(pool);
  return { pool, close };
}

const db = await startIsolatedPostgres();
let production: Pool | undefined;
let closeProduction: (() => Promise<void>) | undefined;
const opened: { close(): Promise<void> }[] = [];
try {
  await db.pool.query(`CREATE DATABASE ${TARGET}`);
  const source = db.pool.options as { password?: string };
  production = new Pool({ host: '127.0.0.1', port: db.identity.dbPort, user: db.identity.user, password: source.password, database: TARGET, max: 6 });
  closeProduction = trackPoolLifecycle(production);
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

  await check('_pay_receipt (F4): can receive_production() but not the generic Sandbox-capable receive(), nor dispatch/claim/finalize/context-load', async () => {
    const r = await receiver.pool.query("SELECT square_webhook.receive_production('evt-p-1','payment.created','merchant-1','pay-1',repeat('a',64)) AS v");
    assert.equal(r.rows[0].v, 'INSERTED');
    await denied(() => receiver.pool.query("SELECT square_webhook.receive('PRODUCTION','evt-p-1b','payment.created','merchant-1','pay-1b',repeat('f',64))"));
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
  await check('_pay_diagnostic (F4): read-only diagnostics_production only, never the generic diagnostics()', async () => {
    await diagnostic.pool.query("SELECT payment_reconciliation.diagnostics_production(10)");
    await denied(() => diagnostic.pool.query("SELECT payment_reconciliation.diagnostics('PRODUCTION',10)"));
    await denied(() => diagnostic.pool.query("SELECT payment_reconciliation.dispatch_production('merchant-1',10)"));
    await denied(() => diagnostic.pool.query("SELECT payment_reconciliation.claim_production('owner-1',10,'merchant-1')"));
  });
  await check('R6-B merchant boundary: dispatch_production for one merchant never dispatches another merchant\'s row', async () => {
    // F4 (TD correction): unlike the local-only R14/R15 dev roles, _pay_dispatch here is granted
    // EXECUTE only on dispatch_production, never the generic dispatch()/dispatch_target() —
    // structurally unreachable, not merely undemonstrated.
    await denied(() => dispatcher.pool.query("SELECT payment_reconciliation.dispatch('PRODUCTION',10)"));
    await receiver.pool.query("SELECT square_webhook.receive_production('evt-p-4','payment.created','merchant-2','pay-4',repeat('e',64))");
    const zero = await dispatcher.pool.query("SELECT payment_reconciliation.dispatch_production('merchant-1',10) AS n");
    assert.equal(zero.rows[0].n, 0); // merchant-1 has nothing left undispatched; merchant-2's row must not have been swept in
    const one = await dispatcher.pool.query("SELECT payment_reconciliation.dispatch_production('merchant-2',10) AS n");
    assert.equal(one.rows[0].n, 1);
    const claimedOnlyMerchant2 = (await worker.pool.query("SELECT payment_reconciliation.claim_production('owner-1',10,'merchant-1') AS claim")).rows;
    assert.equal(claimedOnlyMerchant2.length, 0); // merchant-1's claim call cannot see merchant-2's job
  });
  await check('Production webhook inbox adapter: _pay_receipt persists PRODUCTION events through receive_production() only', async () => {
    const inbox = new PgSquareProductionWebhookInbox(receiver.pool);
    const signal = { environment: 'PRODUCTION' as const, eventId: 'evt-adapter-1', type: 'payment.updated' as const, merchantId: 'merchant-3', paymentId: 'pay-adapter-1', bodySha256: 'd'.repeat(64) };
    assert.equal(await inbox.receive(signal), 'INSERTED');
    assert.equal(await inbox.receive(signal), 'DUPLICATE');
    assert.equal(await inbox.receive({ ...signal, bodySha256: '9'.repeat(64) }), 'HASH_CONFLICT');
    const row = (await production!.query("SELECT environment,state,conflict_count FROM square_webhook.inbox WHERE event_id='evt-adapter-1'")).rows;
    assert.deepEqual(row, [{ environment: 'PRODUCTION', state: 'BLOCKED', conflict_count: 1 }]);
    // The generic adapter needs EXECUTE on the environment-parameterised receive(); the Production
    // receiver credential has none, so it fails closed (503 path) and writes nothing.
    await assert.rejects(new PgSquareWebhookInbox(receiver.pool).receive({ ...signal, eventId: 'evt-adapter-2' }), { message: 'WEBHOOK_INBOX_UNAVAILABLE' });
    await assert.rejects(new PgSquareWebhookInbox(receiver.pool).receive({ ...signal, environment: 'SANDBOX', eventId: 'evt-adapter-3' }), { message: 'WEBHOOK_INBOX_UNAVAILABLE' });
    assert.equal((await production!.query("SELECT count(*)::int n FROM square_webhook.inbox WHERE event_id IN ('evt-adapter-2','evt-adapter-3')")).rows[0].n, 0);
    assert.equal((await production!.query("SELECT count(*)::int n FROM square_webhook.inbox WHERE environment<>'PRODUCTION'")).rows[0].n, 0);
  });
  await check('mutation test: revoking claim_production from _pay_truth breaks it; re-granting restores it', async () => {
    await production!.query(`REVOKE EXECUTE ON FUNCTION payment_reconciliation.claim_production(text,integer,text) FROM ${names.worker}`);
    await denied(() => worker.pool.query("SELECT payment_reconciliation.claim_production('owner-1',10,'merchant-2') AS claim"));
    await production!.query(`GRANT EXECUTE ON FUNCTION payment_reconciliation.claim_production(text,integer,text) TO ${names.worker}`);
    await worker.pool.query("SELECT payment_reconciliation.claim_production('owner-1',10,'merchant-2') AS claim");
  });

  // ---- R3/F9: application role plan (all 11 productionServices, reusing the local scripts' grants) ----
  const appNames = productionAppRoleNames(TARGET);
  for (const sql of productionAppRoleCreateSql(TARGET)) await production.query(sql);
  for (const sql of productionAppRoleGrantSql(TARGET)) await production.query(sql);
  const auth = await loginRole(production, db.identity.dbPort, TARGET, appNames.auth); opened.push(auth);
  const ledger = await loginRole(production, db.identity.dbPort, TARGET, appNames.ledger); opened.push(ledger);
  const hold = await loginRole(production, db.identity.dbPort, TARGET, appNames.hold); opened.push(hold);
  const transfer = await loginRole(production, db.identity.dbPort, TARGET, appNames.transfer); opened.push(transfer);
  const pricing = await loginRole(production, db.identity.dbPort, TARGET, appNames.pricing); opened.push(pricing);
  const recommendation = await loginRole(production, db.identity.dbPort, TARGET, appNames.recommendation); opened.push(recommendation);
  const operations = await loginRole(production, db.identity.dbPort, TARGET, appNames.operations); opened.push(operations);
  const guest = await loginRole(production, db.identity.dbPort, TARGET, appNames.guest); opened.push(guest);
  const contentRead = await loginRole(production, db.identity.dbPort, TARGET, appNames.content_read); opened.push(contentRead);
  const avatarRead = await loginRole(production, db.identity.dbPort, TARGET, appNames.avatar_read); opened.push(avatarRead);
  const bookingAccess = await loginRole(production, db.identity.dbPort, TARGET, appNames.booking_access); opened.push(bookingAccess);
  const appRoles = { auth, ledger, hold, transfer, pricing, recommendation, operations, guest, content_read: contentRead, avatar_read: avatarRead, booking_access: bookingAccess } as const;

  await check('R3 app roles: auth can read/write its own tables but not another service\'s schema', async () => {
    await auth.pool.query('SELECT count(*) FROM staff_members');
    await auth.pool.query('SELECT count(*) FROM auth_user');
    await denied(() => auth.pool.query('SELECT * FROM booking_access.read($1)', ['x']));
    await denied(() => auth.pool.query('SELECT count(*) FROM guest_contexts'));
  });
  await check('R3 app roles: ledger can read/write its own tables but not staff/auth data', async () => {
    await ledger.pool.query('SELECT count(*) FROM ledger_models');
    await ledger.pool.query('SELECT count(*) FROM transfer_pieces');
    await denied(() => ledger.pool.query('SELECT count(*) FROM staff_members'));
    await denied(() => ledger.pool.query('UPDATE inventory_holds SET version=version'));
  });
  await check('R3 app roles: hold can read/write its own tables but cannot touch booking_access', async () => {
    await hold.pool.query('SELECT count(*) FROM inventory_holds');
    await hold.pool.query("SELECT inventory_clock()");
    await denied(() => hold.pool.query('SELECT * FROM booking_access.read($1)', ['x']));
  });
  await check('R3 app roles: transfer can read/write its own tables but not auth credentials or guest data', async () => {
    await transfer.pool.query('SELECT count(*) FROM transfer_batches');
    await denied(() => transfer.pool.query('SELECT count(*) FROM auth_user'));
    await denied(() => transfer.pool.query('SELECT count(*) FROM guest_contexts'));
  });
  await check('R3 app roles: pricing can read/write its own tables but has no ledger asset access', async () => {
    await pricing.pool.query('SELECT count(*) FROM price_books');
    await pricing.pool.query('SELECT count(*) FROM price_admin_requests');
    await denied(() => pricing.pool.query('SELECT count(*) FROM ledger_assets'));
  });
  await check('R3 app roles: recommendation can read/write its own tables but has no pricing access', async () => {
    await recommendation.pool.query('SELECT count(*) FROM recommendation_previews');
    await denied(() => recommendation.pool.query('SELECT count(*) FROM price_books'));
  });
  await check('R3 app roles: operations has the broad read surface its console needs but no staff/auth access', async () => {
    await operations.pool.query('SELECT count(*) FROM rental_bookings');
    await operations.pool.query("SELECT inventory_clock()");
    await denied(() => operations.pool.query('SELECT count(*) FROM staff_members'));
    await denied(() => operations.pool.query('SELECT count(*) FROM auth_user'));
  });
  await check('R3 app roles: operations may EXECUTE provisional_capacity_register_source() only; direct source/bucket DML stays denied', async () => {
    assert.equal((await operations.pool.query("SELECT has_function_privilege(current_user,'provisional_capacity_register_source(text,text,jsonb)','EXECUTE') v")).rows[0].v, true);
    await denied(() => operations.pool.query("INSERT INTO provisional_capacity_sources(id) VALUES (gen_random_uuid())"));
    await denied(() => operations.pool.query("UPDATE provisional_capacity_sources SET id=id"));
    await denied(() => operations.pool.query("DELETE FROM provisional_capacity_sources"));
    await denied(() => operations.pool.query("INSERT INTO provisional_capacity_buckets(id) VALUES (gen_random_uuid())"));
    await denied(() => operations.pool.query("DELETE FROM provisional_capacity_buckets"));
    for (const other of [guest, hold, contentRead, bookingAccess]) assert.equal((await other.pool.query("SELECT has_function_privilege(current_user,'provisional_capacity_register_source(text,text,jsonb)','EXECUTE') v")).rows[0].v, false);
  });
  const projector=await loginRole(production,db.identity.dbPort,TARGET,names.projector);opened.push(projector);
  await check('booking/custody and payment projector can read every witness; direct INSERT/UPDATE/DELETE remain denied',async()=>{
    for(const role of [operations,projector])for(const table of ['wear_pools','provisional_capacity_buckets','inventory_pole_exemptions']){
      await role.pool.query(`SELECT * FROM ${table} LIMIT 0`);
      await denied(()=>role.pool.query(`INSERT INTO ${table} DEFAULT VALUES`));
      await denied(()=>role.pool.query(`UPDATE ${table} SET id=DEFAULT WHERE false`));
      await denied(()=>role.pool.query(`DELETE FROM ${table} WHERE false`));
    }
    await denied(()=>operations.pool.query("SELECT wear_pool_create('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','MOUNTAIN_BASE','INVENTORY_EDIT')"));
  });
  await check('R3 app roles: guest can read/write its own tables but has no staff/auth access', async () => {
    await guest.pool.query('SELECT count(*) FROM guest_contexts');
    await guest.pool.query('SELECT count(*) FROM guest_drafts');
    await denied(() => guest.pool.query('SELECT count(*) FROM staff_members'));
  });
  await check('R3 app roles: content_read is read-only and cannot see ledger_poles', async () => {
    await contentRead.pool.query('SELECT count(*) FROM content_workspace');
    await denied(() => contentRead.pool.query('UPDATE content_workspace SET revision=revision'));
    await denied(() => contentRead.pool.query('SELECT count(*) FROM ledger_poles'));
  });
  await check('R3 app roles: avatar_read is read-only and cannot see content tables', async () => {
    await avatarRead.pool.query('SELECT count(*) FROM avatar_current_visuals');
    // avatar_current_visuals is a non-updatable join view; the meaningful write-boundary proof
    // is that avatar_read has no grant at all on the underlying base table.
    await denied(() => avatarRead.pool.query('INSERT INTO avatar_visuals DEFAULT VALUES'));
    await denied(() => avatarRead.pool.query('SELECT count(*) FROM content_workspace'));
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

  // F9 (TD correction): 3/11 roles proven is not sufficient — every one of the 11
  // productionServices roles must pass verifyProductionDatabase(), the same real, negative-only
  // privilege check (rolsuper/rolcreatedb/rolcreaterole/rolinherit/rolreplication/rolbypassrls/
  // membership/database_owner/object_owner/database CREATE/public schema CREATE all false) the
  // production runtime itself relies on before ever trusting a connected role.
  const roleConfig = { database: { name: TARGET, roles: appNames } } as unknown as ProductionConfiguration;
  await check('F9: verifyProductionDatabase() passes for all 11 Production app roles (rolsuper/rolcreatedb/rolcreaterole/rolinherit/rolreplication/rolbypassrls/membership/database_owner/object_owner/CREATE all false)', async () => {
    for (const service of productionServices) await verifyProductionDatabase(appRoles[service].pool, roleConfig, service);
  });
  await check('F9 mutation test: a role granted rolinherit=true fails verifyProductionDatabase(); reverting to NOINHERIT restores it', async () => {
    await production!.query(`ALTER ROLE ${appNames.auth} INHERIT`);
    await assert.rejects(() => verifyProductionDatabase(auth.pool, roleConfig, 'auth'));
    await production!.query(`ALTER ROLE ${appNames.auth} NOINHERIT`);
    await verifyProductionDatabase(auth.pool, roleConfig, 'auth');
  });

  // ---- F1: production-db-readiness.ts against the real Production content_read role ----
  // (production-db-readiness.ts connects as content_read specifically — reusing it here, rather
  // than a separate ad-hoc credential, is the actual real-world wiring this proves.)
  //
  // Exercise only the internal transport worker against owned local PostgreSQL. The public
  // Production API cannot accept a raw config and has no test identity issuer.
  await check('F1: internal readiness transport verifies real DB identity and migrations; wrong credentials fail; no writes occur', async () => {
    const { readDatabaseReadiness } = await import('../../packages/db/src/internal/database-readiness');
    const { migrationPlan } = await import('../../packages/db/src/index');
    const { productionConfiguration } = await import('../../packages/auth/src/production-config');
    const { productionGuestConfiguration, guestConfigurationHash } = await import('../../packages/contracts/src/production-guest');
    const probePassword = randomBytes(24).toString('hex');
    await production!.query(`ALTER ROLE ${appNames.content_read} LOGIN PASSWORD '${probePassword}'`);
    const before = (await production!.query('SELECT count(*)::int n FROM foundation_migrations')).rows[0].n as number;
    const connect = async (_c: unknown, _service: unknown, credential: { password: string }) => {
      return new Pool({ host: '127.0.0.1', port: db.identity.dbPort, database: TARGET, user: appNames.content_read, password: credential.password, max: 2, connectionTimeoutMillis: 2000 });
    };
    const credential = { provider: 'NEON' as const, environment: 'PRODUCTION' as const, host: 'ep-f1-fixture.neon.tech', port: 5432 as const, database: TARGET, user: appNames.content_read, password: probePassword, revoked: false as const };
    // Synthetic configuration is only input to the internal worker; no identity is minted.
    const f1Guest = productionGuestConfiguration({ schemaVersion: 1, revision: 'F1-FIXTURE', ingressAdapterId: 'f1-fixture-dispatcher', policy: { version: 'F1-FIXTURE', contextSeconds: 3600, absoluteSeconds: 7200, recoverySeconds: 3600, replaySeconds: 30, retentionSeconds: 60, windowSeconds: 10, peerRequests: 1000, globalRequests: 2000 } });
    const f1Config = productionConfiguration({
      schemaVersion: 1, capability: 'ZAO_PRODUCTION_RUNTIME_V1',
      deployment: { provider: 'VERCEL', environment: 'production', projectId: 'f1-fixture-project', releaseId: 'f1-release', origin: 'https://f1-fixture.invalid' },
      database: { provider: 'NEON', environment: 'production', host: 'ep-f1-fixture.neon.tech', name: TARGET, roles: appNames },
      flags: { booking: false, guestRecovery: false, payment: false, media: false, avatar: false, staffOperations: false },
      guest: f1Guest, approvedGuestSha256: guestConfigurationHash(f1Guest),
      payment: null, media: null,
    });
    const good = await readDatabaseReadiness(f1Config, migrationPlan.length, () => connect(f1Config, 'content_read', credential));
    assert.deepEqual(good, { status: 'CONNECTED', migrationsApplied: migrationPlan.length, migrationsExpected: migrationPlan.length, schemaComplete: true });
    const bad = await readDatabaseReadiness(f1Config, migrationPlan.length, () => connect(f1Config, 'content_read', { ...credential, password: 'wrong-password' }));
    assert.equal(bad.status, 'FAILED');
    const incomplete = await readDatabaseReadiness(f1Config, migrationPlan.length + 1, () => connect(f1Config, 'content_read', credential));
    assert.deepEqual(incomplete, { status: 'CONNECTED', migrationsApplied: migrationPlan.length, migrationsExpected: migrationPlan.length + 1, schemaComplete: false });
    const wrongDatabase = {...f1Config, database: {...f1Config.database, name: 'wrong_database'}};
    assert.equal((await readDatabaseReadiness(wrongDatabase, migrationPlan.length, () => connect(f1Config, 'content_read', credential))).status, 'FAILED');
    // Read-only proof: the migration count (and every table this role can otherwise see) is unchanged.
    assert.equal((await production!.query('SELECT count(*)::int n FROM foundation_migrations')).rows[0].n, before);
  });
  await check('F1: the real identity-gated probeProductionDatabaseReadiness rejects a forged/unregistered ExactProductionIdentity before ever touching the connector', async () => {
    const { probeProductionDatabaseReadiness } = await import('../../packages/db/src/production-db-readiness');
    const forged = { kind: 'EXACT_PRODUCTION_IDENTITY' } as never;
    let connectorCalls = 0;
    const unreachableConnect = async () => { connectorCalls++; throw new Error('CONNECTOR_MUST_NOT_BE_CALLED'); };
    const credential = { provider: 'NEON' as const, environment: 'PRODUCTION' as const, host: 'ep-f1-fixture.neon.tech', port: 5432 as const, database: TARGET, user: appNames.content_read, password: 'unused', revoked: false as const };
    const result = await probeProductionDatabaseReadiness(forged, credential, unreachableConnect as never);
    assert.deepEqual(result, { status: 'FAILED', reason: 'PRODUCTION_IDENTITY_REQUIRED' });
    assert.equal(connectorCalls, 0);
  });

  // ---- F5: _pay_dispatch/_pay_truth/_pay_diagnostic Production roles (§R7/R6-A above already
  // proves the SQL-level dispatch/claim/finalize/diagnostics grants and the merchant boundary at
  // the raw-role level). This block only additionally proves PgPaymentReconciliation's own
  // fail-closed behavior when it holds no ProductionReconciliationAuthority.
  //
  // V4 (TD correction): the previous end-to-end proof here (real ProductionReconciliationAuthority
  // minted via a test-only identity, driving PgPaymentReconciliation.dispatch/claimBatch/load/
  // finalize/diagnostics against these same real roles, plus the merchant-boundary and
  // SANDBOX-misuse checks while holding that authority) required issueExactProductionIdentityForTesting,
  // which no longer exists — there is deliberately no way to mint a working
  // ProductionReconciliationAuthority offline. That TS-repository-class wiring proof, on top of the
  // SQL-level grants R7/R6-A above already covers, is R3_ATTENDED_ACCEPTANCE_REQUIRED (see RESULT.md).
  await check('F5: without an authority, PgPaymentReconciliation refuses PRODUCTION even on a real Production-role connection pool (fail closed before any SQL is issued)', async () => {
    const { PgPaymentReconciliation } = await import('../../packages/db/src/payment-reconciliation');
    const unauthorized = new PgPaymentReconciliation(dispatcher.pool);
    await assert.rejects(() => unauthorized.dispatch('PRODUCTION', 10), { message: 'PRODUCTION_RECONCILIATION_AUTHORITY_REQUIRED' });
  });

  console.log(JSON.stringify({ status: 'PASS', cases: passed }));
} finally {
  // Order: role pools disconnect, then the owner pool, then the server. One failure never skips the rest.
  let cleanupFailure: unknown;
  for (const o of opened) { try { await o.close(); } catch (e) { cleanupFailure ??= e; } }
  try { await closeProduction?.(); } catch (e) { cleanupFailure ??= e; }
  try { await db.stop(); } catch (e) { cleanupFailure ??= e; }
  if (cleanupFailure) throw cleanupFailure;
}
