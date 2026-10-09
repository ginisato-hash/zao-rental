import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {LEGAL_DOCS,approvedLegalDocument,approvedLegalDocs,legalCheckoutReady,legalDocument,legalPublicationComplete} from '../../packages/core/src/content/public-legal';
import {GuestBookingService} from '../../packages/core/src/guest/service';

const NOW = Date.parse('2026-10-09T12:00:00Z');
const ok = (over: Record<string, unknown> = {}) => ({doc: 'terms', locale: 'ja', title: '利用規約', state: 'OWNER_APPROVED', approvedBy: 'Owner', approvedAt: '2026-10-09T00:00:00Z',
  sections: [{heading: '第1条', paragraphs: ['本文']}], ...over});

test('the committed legal content publishes nothing until the Owner supplies and approves text', () => {
  const raw = JSON.parse(readFileSync(new URL('../../config/content/public-legal.json', import.meta.url), 'utf8')) as {documents: {doc: string; locale: string; state: string; sections: unknown[]}[]};
  assert.deepEqual(raw.documents.map(d => d.doc + ':' + d.locale).sort(), LEGAL_DOCS.flatMap(d => [d + ':en', d + ':ja']).sort(), 'every document exists in JA and EN');
  for (const d of raw.documents) { assert.equal(d.state, 'OWNER_TEXT_REQUIRED'); assert.deepEqual(d.sections, []); }
  for (const locale of ['ja', 'en'] as const) {
    assert.deepEqual(approvedLegalDocs(locale), []);
    assert.equal(legalPublicationComplete(locale), false, 'the "under review" notices stay visible');
    for (const doc of LEGAL_DOCS) assert.equal(legalDocument(locale, doc), null);
  }
});

test('only a complete, Owner-approved document validates (fail closed on anything missing or malformed)', () => {
  assert.ok(approvedLegalDocument(ok(), NOW));
  for (const [label, over] of [
    ['draft state', {state: 'DRAFT'}], ['text required', {state: 'OWNER_TEXT_REQUIRED'}], ['unknown doc', {doc: 'other'}], ['bad locale', {locale: 'fr'}],
    ['no title', {title: ' '}], ['no approver', {approvedBy: ''}], ['long approver', {approvedBy: 'x'.repeat(121)}], ['no date', {approvedAt: null}],
    ['non-UTC date', {approvedAt: '2026-10-09T09:00:00+09:00'}], ['future approval', {approvedAt: '2026-10-10T00:00:00Z'}], ['no sections', {sections: []}],
    ['empty paragraphs', {sections: [{paragraphs: []}]}], ['blank paragraph', {sections: [{paragraphs: [' ']}]}], ['non-string paragraph', {sections: [{paragraphs: [1]}]}],
    ['blank heading', {sections: [{heading: '', paragraphs: ['x']}]}],
  ] as const) assert.equal(approvedLegalDocument(ok(over as Record<string, unknown>), NOW), null, label);
});

test('JA/EN parity: a document approved in only one locale is published in neither; the set is complete only with all eight', () => {
  const ja = LEGAL_DOCS.map(doc => ok({doc}));
  const en = LEGAL_DOCS.map(doc => ok({doc, locale: 'en', title: 'Terms'}));
  assert.equal(legalDocument('ja', 'terms', ja), null, 'JA approved, EN missing => not published');
  assert.equal(legalPublicationComplete('ja', ja), false);
  assert.equal(legalCheckoutReady(ja), false);
  const all = [...ja, ...en];
  assert.ok(legalDocument('ja', 'terms', all)); assert.ok(legalDocument('en', 'terms', all));
  assert.equal(legalPublicationComplete('ja', all), true); assert.equal(legalPublicationComplete('en', all), true);
  assert.equal(legalCheckoutReady(all), true);
  const enMissingPrivacy = [...ja, ...en.filter(d => d.doc !== 'privacy')];
  assert.deepEqual(approvedLegalDocs('ja', enMissingPrivacy), ['terms', 'commercial-disclosure', 'cancellation']);
  assert.equal(legalCheckoutReady(enMissingPrivacy), false);
  assert.equal(legalCheckoutReady(), false, 'committed content: real checkout is blocked');
});

test('server-side: a commercial checkout is refused while the legal documents are not approved (a ticked checkbox is not enough)', async () => {
  const bookings = {commercialEnabled: () => true} as unknown as ConstructorParameters<typeof GuestBookingService>[3];
  const make = (ready?: () => boolean) => new GuestBookingService({} as never, {} as never, {} as never, bookings, async () => ({}) as never,
    {applicationId: 'sq0idp-x', locations: {}}, ready);
  const body = {draftId: 'd', expectedRevision: 1, contact: {displayName: 'A', email: 'a@example.test', termsAccepted: true}, reviewHash: 'h', paymentSource: 'cnon:x'};
  await assert.rejects(make(() => false).checkout(body), (e: Error & {code?: string}) => e.code === 'LEGAL_DOCUMENTS_NOT_APPROVED');
  await assert.rejects(make(legalCheckoutReady).checkout(body), (e: Error & {code?: string}) => e.code === 'LEGAL_DOCUMENTS_NOT_APPROVED', 'committed content blocks a real charge');
  // with approval the gate is passed (the call then fails later on the fake draft, not on the legal gate)
  await assert.rejects(make(() => true).checkout(body), (e: Error & {code?: string}) => e.code !== 'LEGAL_DOCUMENTS_NOT_APPROVED');
  // non-commercial (simulated/fixture) checkout is not affected by the gate
  const sim = new GuestBookingService({} as never, {} as never, {} as never, {commercialEnabled: () => false} as never, async () => ({}) as never, undefined, () => false);
  await assert.rejects(sim.checkout({draftId: 'd', expectedRevision: 1, contact: {}, reviewHash: 'h'}), (e: Error & {code?: string}) => e.code !== 'LEGAL_DOCUMENTS_NOT_APPROVED');
});
