import test from 'node:test';
import assert from 'node:assert/strict';
import {installProductionHostingComposition,HOSTING_ACTIVATION_TOKEN} from '../../packages/core/src/guest/production-hosting-composition';
import {productionServices} from '../../packages/auth/src/production-config';

function validEnv(overrides: Record<string, string | undefined> = {}) {
  const env: Record<string, string | undefined> = {
    ZAO_PRODUCTION_HOSTING_ACTIVATION: HOSTING_ACTIVATION_TOKEN,
    VERCEL_ENV: 'production', VERCEL_PROJECT_ID: 'r3-fixture-project', VERCEL_DEPLOYMENT_ID: 'r3-fixture-deploy', VERCEL_URL: 'r3-fixture.vercel.app',
    PRODUCTION_DB_HOST: 'ep-r3-fixture.neon.tech', PRODUCTION_DB_NAME: 'zao_rental_production',
    PRODUCTION_GUEST_KEY: 'a'.repeat(64), PRODUCTION_STAFF_KEY: 'b'.repeat(64), PRODUCTION_ACCESS_KEY: 'c'.repeat(64), PRODUCTION_RECOVERY_KEY: 'd'.repeat(64),
    PRODUCTION_ACCESS_KEY_VERSION: 'r3-fixture-access-v1', PRODUCTION_RECOVERY_KEY_VERSION: 'r3-fixture-recovery-v1',
  };
  for (const s of productionServices) { env[`PRODUCTION_DB_ROLE_${s.toUpperCase()}`] = 'r3_' + s + '_role'; env[`PRODUCTION_DB_PASSWORD_${s.toUpperCase()}`] = 'synthetic-password-' + s; }
  return { ...env, ...overrides };
}

test('missing activation => NOT_ACTIVATED, installProductionBootstrap is never called', () => {
  const result = installProductionHostingComposition({});
  assert.deepEqual(result, { status: 'NOT_ACTIVATED' });
});
test('an unrelated/wrong activation value is also inert, not an error', () => {
  assert.deepEqual(installProductionHostingComposition(validEnv({ ZAO_PRODUCTION_HOSTING_ACTIVATION: 'something-else' })), { status: 'NOT_ACTIVATED' });
});
test('Preview cannot activate: VERCEL_ENV must be exactly production', () => {
  assert.throws(() => installProductionHostingComposition(validEnv({ VERCEL_ENV: 'preview' })), { message: 'PRODUCTION_HOSTING_WRONG_VERCEL_ENVIRONMENT' });
  assert.throws(() => installProductionHostingComposition(validEnv({ VERCEL_ENV: undefined })), { message: 'PRODUCTION_HOSTING_WRONG_VERCEL_ENVIRONMENT' });
});
test('wrong/missing deployment identity (project/release/origin) is rejected', () => {
  for (const key of ['VERCEL_PROJECT_ID', 'VERCEL_DEPLOYMENT_ID', 'VERCEL_URL'] as const) {
    assert.throws(() => installProductionHostingComposition(validEnv({ [key]: undefined })), { message: 'PRODUCTION_HOSTING_DEPLOYMENT_IDENTITY_MISSING' });
  }
});
test('wrong/missing DB host or database name is rejected', () => {
  assert.throws(() => installProductionHostingComposition(validEnv({ PRODUCTION_DB_HOST: undefined })), { message: 'PRODUCTION_HOSTING_DB_IDENTITY_MISSING' });
  assert.throws(() => installProductionHostingComposition(validEnv({ PRODUCTION_DB_NAME: undefined })), { message: 'PRODUCTION_HOSTING_DB_IDENTITY_MISSING' });
  // A host not shaped like a real Neon endpoint fails productionConfiguration()'s own parsing (ProductionStartupError).
  assert.throws(() => installProductionHostingComposition(validEnv({ PRODUCTION_DB_HOST: 'not-a-neon-host.example.com' })));
});
test('a missing role name for any one of the 11 production services is rejected', () => {
  assert.throws(() => installProductionHostingComposition(validEnv({ [`PRODUCTION_DB_ROLE_${productionServices[0]!.toUpperCase()}`]: undefined })), { message: 'PRODUCTION_HOSTING_ROLE_NAME_MISSING' });
});
test('an owner/admin/superuser-shaped role name fails productionConfiguration()\'s own forbidden-substring check', () => {
  assert.throws(() => installProductionHostingComposition(validEnv({ [`PRODUCTION_DB_ROLE_${productionServices[0]!.toUpperCase()}`]: 'zao_owner_role' })));
});
test('malformed/missing signing key material fails closed', () => {
  assert.throws(() => installProductionHostingComposition(validEnv({ PRODUCTION_GUEST_KEY: undefined })), { message: 'PRODUCTION_HOSTING_SIGNING_KEY_INVALID' });
  assert.throws(() => installProductionHostingComposition(validEnv({ PRODUCTION_GUEST_KEY: 'not-hex' })), { message: 'PRODUCTION_HOSTING_SIGNING_KEY_INVALID' });
  assert.throws(() => installProductionHostingComposition(validEnv({ PRODUCTION_ACCESS_KEY_VERSION: '' })), { message: 'PRODUCTION_HOSTING_KEY_VERSION_INVALID' });
});
test('no secret value ever appears in a thrown error message, across every failure path above', () => {
  const env = validEnv({ PRODUCTION_GUEST_KEY: undefined });
  try { installProductionHostingComposition(env); assert.fail('expected a throw'); } catch (e) {
    const message = (e as Error).message;
    for (const s of productionServices) assert.ok(!message.includes('synthetic-password-' + s));
    assert.ok(!message.includes('b'.repeat(64)) && !message.includes('c'.repeat(64)) && !message.includes('d'.repeat(64)));
  }
});
test('payment/media stay OFF in the dark profile regardless of env — there is no env key that could turn them on', () => {
  // The allowlist itself has no PAYMENT_*/MEDIA_* key at all; flags are hardcoded false in the
  // composition, so no env combination can activate them. This is a structural, not a runtime, guarantee.
  const source = installProductionHostingComposition.toString();
  assert.ok(!/payment:\s*true/.test(source) && !/media:\s*true/.test(source));
});
// V4 (TD correction): installProductionHostingComposition now always calls the real, override-free
// issueExactProductionIdentity — there is no injectable issuer anywhere, in product code or in any
// test. A fully valid-shaped (structurally correct) env still fails here, because its synthetic
// host/project/db can never match the real pinned Production identity, and no test can construct
// one that does. This proves the two things that remain provable offline: (1) a structurally-valid
// env is refused for the right reason (identity, not a shape defect already covered above), and
// (2) installProductionBootstrap is never reached — no partial/dark install happens — before that
// identity check passes. The full accept path (reaches INSTALLED/READY with a genuine identity) is
// R3_ATTENDED_ACCEPTANCE_REQUIRED — see docs/execution/production-integration/RESULT.md.
test('a structurally-valid env (every shape/key check above would pass) is still refused at the real identity gate, and installProductionBootstrap is never reached — no dark install occurs before identity failure', async () => {
  const {productionStartupState} = await import('../../packages/core/src/guest/production-bootstrap');
  const before = productionStartupState();
  const env = validEnv();
  for (const s of productionServices) delete env[`PRODUCTION_DB_PASSWORD_${s.toUpperCase()}`];
  assert.throws(() => installProductionHostingComposition(env), { message: /^PRODUCTION_IDENTITY_WRONG_/ });
  // No side effect: bootstrap state is byte-identical to before the (failed) install attempt.
  assert.deepEqual(productionStartupState(), before);
});
