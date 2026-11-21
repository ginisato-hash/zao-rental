import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {currentRentalTerms, rentalTermsCanonical, RENTAL_TERMS_VERSION} from '../../packages/core/src/content/rental-terms';
import {commercialContact, syntheticContact} from '../../packages/contracts/src/rental-flow';
import {legalDocument} from '../../packages/core/src/content/public-legal';

const migration = readFileSync(new URL('../../packages/db/migrations/0059_rental_terms_acceptance.sql', import.meta.url), 'utf8');
const base = {displayName: 'Guest', email: 'guest@example.com', termsAccepted: true};

test('0059 stores exactly the published JA/EN terms + cancellation text and its SHA-256', () => {
  const ref = currentRentalTerms();
  assert.equal(ref.version, 'ZAO_RENTAL_TERMS_V2');
  assert.equal(createHash('sha256').update(rentalTermsCanonical(), 'utf8').digest('hex'), ref.sha256);
  assert.ok(migration.includes(`'${RENTAL_TERMS_VERSION}'`) && migration.includes(`'${ref.sha256}'`), 'migration pins the current hash');
  assert.ok(migration.includes('$terms$' + rentalTermsCanonical() + '$terms$'), 'migration body equals the published text; regenerate 0059 only with a new version');
});

test('the published text carries the adopted conditions and keeps the 48-hour arithmetic', () => {
  const ja = JSON.stringify(legalDocument('ja', 'terms')!.sections), en = JSON.stringify(legalDocument('en', 'terms')!.sections);
  for (const s of ['小売価格の50%を上限', 'ちょうど48時間前のキャンセルも対象', 'リフト運休', '購入時に確認・同意した版', '法令上負う責任を免除または制限するものではありません']) assert.ok(ja.includes(s), s);
  for (const s of ['50% of the model', 'exactly 48 hours before the start is eligible', 'lift closures', 'reviewed and accepted at purchase']) assert.ok(en.includes(s), s);
  assert.ok(!/延滞料|late fee/i.test(ja + en), 'no new late fee is introduced');
});

test('commercial contact: missing, old or altered bundle is refused; the current one is recorded with locale', () => {
  const ref = currentRentalTerms();
  assert.throws(() => commercialContact(base, ref), {code: 'INVALID_INPUT'});
  assert.throws(() => commercialContact({...base, terms: null}, ref), {code: 'TERMS_ACCEPTANCE_REQUIRED'});
  assert.throws(() => commercialContact({...base, terms: {version: 'ZAO_RENTAL_TERMS_V1', sha256: ref.sha256, locale: 'ja'}}, ref), {code: 'TERMS_VERSION_MISMATCH'});
  assert.throws(() => commercialContact({...base, terms: {version: ref.version, sha256: '0'.repeat(64), locale: 'ja'}}, ref), {code: 'TERMS_VERSION_MISMATCH'});
  assert.throws(() => commercialContact({...base, terms: {version: ref.version, sha256: ref.sha256, locale: 'fr'}}, ref), {code: 'TERMS_ACCEPTANCE_REQUIRED'});
  assert.throws(() => commercialContact({...base, termsAccepted: false, terms: {...ref, locale: 'ja'}}, ref), {code: 'INVALID_BOOKING_CONTACT'});
  assert.throws(() => commercialContact({...base, terms: {...ref, locale: 'ja'}}), {code: 'TERMS_VERSION_MISMATCH'}, 'no expected bundle => fail closed');
  const ok = commercialContact({...base, terms: {...ref, locale: 'en'}}, ref);
  assert.deepEqual(ok, {displayName: 'Guest', email: 'guest@example.com', termsAccepted: true, termsVersion: 'ZAO_CANCELLATION_V1', rentalTerms: {version: ref.version, sha256: ref.sha256, locale: 'en'}});
});

test('synthetic preview contact ignores a terms reference so one client body serves both modes', () => {
  const c = {displayName: 'SYNTHETIC Guest', email: 'synthetic-guest@example.invalid', termsAccepted: true};
  assert.deepEqual(syntheticContact({...c, terms: {...currentRentalTerms(), locale: 'ja'}}), syntheticContact(c));
});
