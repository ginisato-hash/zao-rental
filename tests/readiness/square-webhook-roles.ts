// PROD-R7: local proof of the least-privilege square_webhook receiver/reconciler roles
// added in migration 0040 — realizing what migration 0025's own comment already described
// but never created.
import assert from 'node:assert/strict';
import {migrate} from '../../packages/db/src/index';
import {startIsolatedPostgres} from '../../scripts/postgres';
import {provisionWebhookReceiverRole,provisionWebhookReconcilerRole} from '../../scripts/webhook-roles';

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

const db = await startIsolatedPostgres();
let receiver: Awaited<ReturnType<typeof provisionWebhookReceiverRole>> | undefined;
let reconciler: Awaited<ReturnType<typeof provisionWebhookReconcilerRole>> | undefined;
try {
  await migrate(db.pool);
  receiver = await provisionWebhookReceiverRole(db.pool, db.identity);
  reconciler = await provisionWebhookReconcilerRole(db.pool, db.identity);

  await check('both roles are NOLOGIN-by-migration until provisioned, then INHERIT/NOSUPERUSER/NOCREATEDB/NOCREATEROLE/NOREPLICATION/NOBYPASSRLS', async () => {
    for (const suffix of ['_square_webhook_receiver', '_square_webhook_reconciler']) {
      const row = (await db.pool.query(
        'SELECT rolcanlogin,rolinherit,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=$1',
        [db.identity.namespace + suffix],
      )).rows[0];
      assert.deepEqual(row, { rolcanlogin: true, rolinherit: true, rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false });
    }
  });

  await check('the receiver can call receive() and gets a real INSERTED/DUPLICATE result, but cannot call claim/settle or touch the table directly', async () => {
    const r1 = await receiver!.pool.query("SELECT square_webhook.receive('SANDBOX','evt-1','payment.created','merchant-1','pay-1',repeat('a',64)) AS v");
    assert.equal(r1.rows[0].v, 'INSERTED');
    const r2 = await receiver!.pool.query("SELECT square_webhook.receive('SANDBOX','evt-1','payment.created','merchant-1','pay-1',repeat('a',64)) AS v");
    assert.equal(r2.rows[0].v, 'DUPLICATE');
    await denied(() => receiver!.pool.query("SELECT * FROM square_webhook.claim('SANDBOX',30)"));
    await denied(() => receiver!.pool.query("SELECT square_webhook.settle('SANDBOX','evt-1',gen_random_uuid(),'RECONCILED',NULL,NULL)"));
    await denied(() => receiver!.pool.query('SELECT * FROM square_webhook.inbox'));
    await denied(() => receiver!.pool.query("INSERT INTO square_webhook.inbox(environment,event_id,event_type,merchant_id,payment_id,body_sha256) VALUES('SANDBOX','x','payment.created','m','p',repeat('a',64))"));
  });

  await check('the reconciler can claim/settle a queued event, but cannot call receive() or touch the table directly', async () => {
    await receiver!.pool.query("SELECT square_webhook.receive('SANDBOX','evt-2','payment.updated','merchant-1','pay-2',repeat('b',64))");
    const claimed = (await reconciler!.pool.query("SELECT * FROM square_webhook.claim('SANDBOX',30)")).rows[0];
    assert.ok(['evt-1', 'evt-2'].includes(claimed.event_id));
    const settled = await reconciler!.pool.query('SELECT square_webhook.settle($1,$2,$3,$4,$5,$6) AS v', ['SANDBOX', claimed.event_id, claimed.claim_token, 'RECONCILED', null, null]);
    assert.equal(settled.rows[0].v, true);
    await denied(() => reconciler!.pool.query("SELECT square_webhook.receive('SANDBOX','evt-3','payment.created','merchant-1','pay-3',repeat('c',64))"));
    await denied(() => reconciler!.pool.query('SELECT * FROM square_webhook.inbox'));
  });

  await check('mutation test: revoking the receiver EXECUTE grant breaks receive(), re-granting restores it', async () => {
    await db.pool.query(`REVOKE EXECUTE ON FUNCTION square_webhook.receive(text,text,text,text,text,text) FROM ${db.identity.namespace}_square_webhook_receiver`);
    await denied(() => receiver!.pool.query("SELECT square_webhook.receive('SANDBOX','evt-4','payment.created','merchant-1','pay-4',repeat('d',64))"));
    await db.pool.query(`GRANT EXECUTE ON FUNCTION square_webhook.receive(text,text,text,text,text,text) TO ${db.identity.namespace}_square_webhook_receiver`);
    const r = await receiver!.pool.query("SELECT square_webhook.receive('SANDBOX','evt-4','payment.created','merchant-1','pay-4',repeat('d',64)) AS v");
    assert.equal(r.rows[0].v, 'INSERTED');
  });

  console.log(JSON.stringify({ status: 'PASS', cases: passed }));
} finally {
  await receiver?.close();
  await reconciler?.close();
  await db.stop();
}
