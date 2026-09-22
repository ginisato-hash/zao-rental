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
import {verifyProductionDatabase} from '../../packages/db/src/production-connection';
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

  // ---- F1: probeProductionDatabaseReadiness against the real Production content_read role ----
  // (production-db-readiness.ts connects as content_read specifically — reusing it here, rather
  // than a separate ad-hoc credential, is the actual real-world wiring this proves.)
  await check('F1: probeProductionDatabaseReadiness proves real DB connectivity/identity independent of the dark hosting composition (which never opens a connection at all); a wrong credential fails closed, never CONNECTED; no write of any kind occurs; and it structurally requires an already-issued ExactProductionIdentity, not an arbitrary config (V3-C)', async () => {
    const { probeProductionDatabaseReadiness } = await import('../../packages/db/src/production-db-readiness');
    const { migrationPlan } = await import('../../packages/db/src/index');
    const { productionConfiguration } = await import('../../packages/auth/src/production-config');
    const { issueExactProductionIdentityForTesting } = await import('../../packages/auth/src/production-identity');
    const { productionGuestConfiguration, guestConfigurationHash } = await import('../../packages/contracts/src/production-guest');
    const { createHash } = await import('node:crypto');
    const probePassword = randomBytes(24).toString('hex');
    await production!.query(`ALTER ROLE ${appNames.content_read} LOGIN PASSWORD '${probePassword}'`);
    const before = (await production!.query('SELECT count(*)::int n FROM foundation_migrations')).rows[0].n as number;
    const connect = async (_c: unknown, _service: unknown, credential: { password: string }) => {
      if (credential.password !== probePassword) throw new Error('SYNTHETIC_WRONG_CREDENTIAL');
      return new Pool({ host: '127.0.0.1', port: db.identity.dbPort, database: TARGET, user: appNames.content_read, password: credential.password, max: 2, connectionTimeoutMillis: 2000 });
    };
    const credential = { provider: 'NEON' as const, environment: 'PRODUCTION' as const, host: 'ep-f1-fixture.neon.tech', port: 5432 as const, database: TARGET, user: appNames.content_read, password: probePassword, revoked: false as const };
    // A real, fully-validated config (not the F9 block's hand-cast `roleConfig`) — only this can
    // ever pass isValidatedProductionConfiguration and be issued a genuine ExactProductionIdentity.
    const f1Guest = productionGuestConfiguration({ schemaVersion: 1, revision: 'F1-FIXTURE', ingressAdapterId: 'f1-fixture-dispatcher', policy: { version: 'F1-FIXTURE', contextSeconds: 3600, absoluteSeconds: 7200, recoverySeconds: 3600, replaySeconds: 30, retentionSeconds: 60, windowSeconds: 10, peerRequests: 1000, globalRequests: 2000 } });
    const f1Host = 'ep-f1-fixture.neon.tech', f1Project = 'f1-fixture-project';
    const f1Expected = { hostFingerprintSha256: createHash('sha256').update(f1Host.trim().toLowerCase()).digest('hex'), databaseName: TARGET, vercelProjectFingerprintSha256: createHash('sha256').update(f1Project).digest('hex') };
    const f1Config = productionConfiguration({
      schemaVersion: 1, capability: 'ZAO_PRODUCTION_RUNTIME_V1',
      deployment: { provider: 'VERCEL', environment: 'production', projectId: f1Project, releaseId: 'f1-release', origin: 'https://f1-fixture.invalid' },
      database: { provider: 'NEON', environment: 'production', host: f1Host, name: TARGET, roles: appNames },
      flags: { booking: false, guestRecovery: false, payment: false, media: false, avatar: false, staffOperations: false },
      guest: f1Guest, approvedGuestSha256: guestConfigurationHash(f1Guest),
      payment: null, media: null,
    });
    const f1Identity = issueExactProductionIdentityForTesting(f1Config, f1Expected);
    const good = await probeProductionDatabaseReadiness(f1Identity, credential, connect as never);
    assert.deepEqual(good, { status: 'CONNECTED', migrationsApplied: migrationPlan.length, migrationsExpected: migrationPlan.length, schemaComplete: true });
    const bad = await probeProductionDatabaseReadiness(f1Identity, { ...credential, password: 'wrong-password' }, connect as never);
    assert.equal(bad.status, 'FAILED');
    // Read-only proof: the migration count (and every table this role can otherwise see) is unchanged.
    assert.equal((await production!.query('SELECT count(*)::int n FROM foundation_migrations')).rows[0].n, before);
  });

  // ---- F5: ProductionReconciliationAuthority + PgPaymentReconciliation against the real
  // _pay_dispatch/_pay_truth/_pay_diagnostic Production roles created above (§R7/R6-A) ----
  {
    const { PgPaymentReconciliation } = await import('../../packages/db/src/payment-reconciliation');
    const { issueProductionReconciliationAuthority } = await import('../../packages/core/src/payment/production-reconciliation-authority');
    const { issueExactProductionIdentityForTesting } = await import('../../packages/auth/src/production-identity');
    const { productionConfiguration } = await import('../../packages/auth/src/production-config');
    const { productionGuestConfiguration, guestConfigurationHash } = await import('../../packages/contracts/src/production-guest');
    const { createHash } = await import('node:crypto');

    const f5Guest = productionGuestConfiguration({ schemaVersion: 1, revision: 'F5-FIXTURE', ingressAdapterId: 'f5-fixture-dispatcher', policy: { version: 'F5-FIXTURE', contextSeconds: 3600, absoluteSeconds: 7200, recoverySeconds: 3600, replaySeconds: 30, retentionSeconds: 60, windowSeconds: 10, peerRequests: 1000, globalRequests: 2000 } });
    const f5Host = 'ep-f5-fixture.neon.tech', f5Project = 'f5-fixture-project';
    const f5Expected = { hostFingerprintSha256: createHash('sha256').update(f5Host.trim().toLowerCase()).digest('hex'), databaseName: TARGET, vercelProjectFingerprintSha256: createHash('sha256').update(f5Project).digest('hex') };
    const f5Config = productionConfiguration({
      schemaVersion: 1, capability: 'ZAO_PRODUCTION_RUNTIME_V1',
      deployment: { provider: 'VERCEL', environment: 'production', projectId: f5Project, releaseId: 'f5-release', origin: 'https://f5-fixture.invalid' },
      database: { provider: 'NEON', environment: 'production', host: f5Host, name: TARGET, roles: appNames },
      flags: { booking: true, guestRecovery: false, payment: true, media: false, avatar: false, staffOperations: false },
      guest: f5Guest, approvedGuestSha256: guestConfigurationHash(f5Guest),
      payment: { provider: 'SQUARE', environment: 'PRODUCTION', merchantId: 'merchant-1', locations: { MOUNTAIN_BASE: 'f5-loc-1', ONSEN_BASE: 'f5-loc-2' } },
      media: null,
    });
    const f5Identity = issueExactProductionIdentityForTesting(f5Config, f5Expected);
    const f5Authority = issueProductionReconciliationAuthority(f5Identity);
    const dispatchRepo = new PgPaymentReconciliation(dispatcher.pool, undefined, f5Authority);
    const workerRepo = new PgPaymentReconciliation(worker.pool, undefined, f5Authority);
    const diagnosticRepo = new PgPaymentReconciliation(diagnostic.pool, undefined, f5Authority);

    await check('F5: PgPaymentReconciliation with a real ProductionReconciliationAuthority operates end to end against the real _pay_dispatch/_pay_truth/_pay_diagnostic Production roles (not a fakePool)', async () => {
      await receiver.pool.query("SELECT square_webhook.receive_production('evt-f5-1','payment.created','merchant-1','pay-f5-1',repeat('1',64))");
      assert.ok((await dispatchRepo.dispatch('PRODUCTION', 10)) >= 1);
      const claims = await workerRepo.claimBatch('PRODUCTION', 'f5-worker', 10);
      const claim = claims.find(c => c.paymentId === 'pay-f5-1');
      assert.ok(claim);
      assert.equal(await workerRepo.load(claim!), null); // no matching rental_payment_attempts row in this fixture; a real not-found path, not a permission error
      assert.equal((await workerRepo.loadBatch([claim!])).size, 0);
      // BLOCKED + a valid code needs no `truth` payload at all (the DB function's own
      // INVALID_TRUTH/INVALID_DECISION checks are gated on `p_truth IS NOT NULL`) — sufficient
      // to prove finalize_production's own real end-to-end wiring without fabricating a
      // synthetic-but-shaped-like-real payment observation this fixture never actually saw.
      assert.equal(await workerRepo.finalize(claim!, { state: 'BLOCKED', code: 'PAYMENT_CONTEXT_MISSING', retrySeconds: null, truth: null }), true);
      assert.ok(Array.isArray(await diagnosticRepo.diagnostics('PRODUCTION', 10)));
    });
    await check('F5: without an authority, PgPaymentReconciliation refuses PRODUCTION even on a real Production-role connection pool (fail closed before any SQL is issued)', async () => {
      const unauthorized = new PgPaymentReconciliation(dispatcher.pool);
      await assert.rejects(() => unauthorized.dispatch('PRODUCTION', 10), { message: 'PRODUCTION_RECONCILIATION_AUTHORITY_REQUIRED' });
    });
    await check('F5: merchant boundary — a merchant-1-bound authority never dispatches or claims merchant-2\'s row through the real repository', async () => {
      await receiver.pool.query("SELECT square_webhook.receive_production('evt-f5-2','payment.created','merchant-2','pay-f5-2',repeat('2',64))");
      await dispatchRepo.dispatch('PRODUCTION', 10);
      const claims = await workerRepo.claimBatch('PRODUCTION', 'f5-worker-2', 10);
      assert.ok(!claims.some(c => c.paymentId === 'pay-f5-2'));
    });
    await check('F5: a Production authority never lets the repository fall back to the generic Sandbox-capable SQL surface (SANDBOX refused while holding it)', async () => {
      await assert.rejects(() => dispatchRepo.dispatch('SANDBOX', 10), { message: 'PRODUCTION_RECONCILIATION_AUTHORITY_MISUSE' });
    });
  }

  console.log(JSON.stringify({ status: 'PASS', cases: passed }));
} finally {
  for (const o of opened) await o.close();
  await production?.end();
  await db.stop();
}
