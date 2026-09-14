import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sandboxAcceptanceEnvironment, sandboxEnvironmentNames as names, sandboxSecretEnvironmentNames} from '../../packages/core/src/payment/sandbox-environment';
import {SQUARE_VERSION, SQUARE_SANDBOX_ORIGIN} from '../../packages/core/src/payment/square-sandbox';
import {sandboxActivationMetadata} from '../../packages/core/src/payment/sandbox-preflight';

const fixture = (): Record<string, string | undefined> => ({
  VERCEL_ENV: 'preview', NODE_ENV: 'production',
  [names.environment]: 'SANDBOX', [names.apiVersion]: SQUARE_VERSION,
  [names.applicationId]: 'synthetic-app', [names.locationId]: 'synthetic-location',
});

test('P6 one acceptance location is metadata only; it does not map or activate either internal store', () => {
  const c = sandboxAcceptanceEnvironment(fixture());
  assert.equal(c.acceptanceLocationId, 'synthetic-location');
  assert.equal(c.merchantId, null);
  assert.equal(c.notificationUrl, null);
  assert.equal(c.internalStoreMapping, 'OWNER_PENDING');
  assert.equal(c.merchantLocationVerified, false);
  assert.equal(c.activation, 'DISABLED');
  assert.equal(c.origin, SQUARE_SANDBOX_ORIGIN);
  assert.equal(c.apiVersion, SQUARE_VERSION);
  assert.equal('locations' in c, false);
  assert.equal(Object.isFrozen(c), true);
  // The single-location shape cannot silently enter the old two-store activation contract.
  assert.throws(() => sandboxActivationMetadata(c, new Date('2035-01-01')));
});

test('P6 metadata parser never reads credential values, including during error handling', () => {
  const env = fixture();
  for (const name of sandboxSecretEnvironmentNames) Object.defineProperty(env, name, {
    enumerable: true, get() { throw new Error('SECRET_VALUE_MUST_NOT_BE_READ'); },
  });
  const c = sandboxAcceptanceEnvironment(env);
  assert.equal(c.accessKeyId, names.accessToken);
  assert.equal(c.webhookKeyId, names.webhookSignatureKey);
  assert.equal(Object.keys(c).includes('accessToken'), false);
  env[names.environment] = 'PRODUCTION';
  assert.throws(() => sandboxAcceptanceEnvironment(env), {code: 'SANDBOX_ENVIRONMENT_INVALID'});
});

test('P6 rejects production/development, omitted mode/version, aliases and public settings', () => {
  for (const patch of [
    {VERCEL_ENV: 'production'}, {VERCEL_ENV: 'development'}, {VERCEL_ENV: undefined},
    {[names.environment]: 'PRODUCTION'}, {[names.environment]: undefined},
    {[names.apiVersion]: '2026-01-01'}, {[names.apiVersion]: undefined},
    {[names.applicationId]: ''}, {[names.locationId]: ' bad '},
    {[names.applicationId]: undefined, SQUARE_APPLICATION_ID: 'alias-not-accepted'},
    {[names.merchantId]: ''}, {NEXT_PUBLIC_ANY_SETTING: 'not-approved'},
  ]) assert.throws(() => sandboxAcceptanceEnvironment({...fixture(), ...patch}), {code: 'SANDBOX_ENVIRONMENT_INVALID'});
});

test('P6 URL is exact non-secret HTTPS metadata, not inferred from request headers or aliases', () => {
  const url = 'https://synthetic.invalid/existing-reviewed-path';
  const c = sandboxAcceptanceEnvironment({...fixture(), [names.notificationUrl]: url, [names.merchantId]: 'synthetic-merchant'});
  assert.equal(c.notificationUrl, url);
  assert.equal(c.merchantLocationVerified, false);
  for (const value of ['', 'http://synthetic.invalid/path', 'https://u:p@synthetic.invalid/path',
    url + '?bypass=x', url + '#fragment', ' https://synthetic.invalid/path ', 'https://SYNTHETIC.invalid/path']) {
    assert.throws(() => sandboxAcceptanceEnvironment({...fixture(), [names.notificationUrl]: value}), {code: 'SANDBOX_ENVIRONMENT_INVALID'});
  }
});
