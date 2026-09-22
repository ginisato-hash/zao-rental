// F10 (TD correction): a PostgreSQL identifier is 63 bytes; beyond that Postgres silently
// truncates rather than erroring, which could make two intended-distinct role names collide
// without any visible failure. `assertProductionDatabaseName`'s own regex already caps a
// caller-supplied database name at 63 characters, but every one of these three generators
// appends a fixed suffix (e.g. `_recommendation`, `_pay_projection`, `_backup`) to build the
// actual role name — the combined, generated name is what must never silently exceed 63 bytes,
// which is a materially different (and materially larger) input space than the base name alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import {productionAppRoleNames} from '../../scripts/production-app-roles';
import {productionPaymentRoleNames} from '../../scripts/production-payment-roles';
import {productionBackupRoleSql} from '../../scripts/production-backup-role';

// All ASCII lowercase, so byte length equals character length throughout this file.
const name = (n: number) => 'a'.repeat(n);

test('F10: productionAppRoleNames — the longest suffixes (_recommendation/_booking_access, 15 bytes) allow exactly 63 total bytes and reject 64', () => {
  assert.doesNotThrow(() => productionAppRoleNames(name(48)));
  const ok = productionAppRoleNames(name(48));
  assert.equal(Buffer.byteLength(ok.recommendation, 'utf8'), 63);
  assert.equal(Buffer.byteLength(ok.booking_access, 'utf8'), 63);
  assert.throws(() => productionAppRoleNames(name(49)), { message: 'PRODUCTION_ROLE_NAME_TOO_LONG' });
});
test('F10: productionPaymentRoleNames — the longest suffixes (_pay_projection/_pay_diagnostic, 15 bytes) allow exactly 63 total bytes and reject 64', () => {
  const ok = productionPaymentRoleNames(name(48));
  assert.equal(Buffer.byteLength(ok.projector, 'utf8'), 63);
  assert.equal(Buffer.byteLength(ok.diagnostic, 'utf8'), 63);
  assert.throws(() => productionPaymentRoleNames(name(49)), { message: 'PRODUCTION_ROLE_NAME_TOO_LONG' });
});
test('F10: productionBackupRoleSql — the default `_backup` suffix (7 bytes) allows exactly 63 total bytes and rejects 64', () => {
  assert.doesNotThrow(() => productionBackupRoleSql(name(56)));
  assert.throws(() => productionBackupRoleSql(name(57)), { message: 'PRODUCTION_ROLE_NAME_INVALID' });
});
test('F10: an explicit (non-default) backup role name is independently bounded at 63 bytes, 64 rejected', () => {
  assert.doesNotThrow(() => productionBackupRoleSql(name(10), name(63)));
  assert.throws(() => productionBackupRoleSql(name(10), name(64)), { message: 'PRODUCTION_ROLE_NAME_INVALID' });
});
test('F10: distinct-after-truncation inputs never silently collide — both boundary-length role sets remain distinct role names', () => {
  const a = productionAppRoleNames(name(48)), p = productionPaymentRoleNames(name(48));
  const all = [...Object.values(a), ...Object.values(p)];
  assert.equal(new Set(all).size, all.length);
});
