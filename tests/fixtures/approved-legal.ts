import {LEGAL_DOCS,legalCheckoutReady} from '../../packages/core/src/content/public-legal';
/** Explicit SYNTHETIC approved legal set for commercial test fixtures only (never production content). A commercial fixture
 * must pass this deliberately; a missing gate is refused by GuestBookingService, not bypassed. */
export const SYNTHETIC_APPROVED_LEGAL = LEGAL_DOCS.flatMap(doc => (['ja', 'en'] as const).map(locale => ({
  doc, locale, title: 'SYNTHETIC ' + doc, state: 'OWNER_APPROVED', approvedBy: 'synthetic-fixture', approvedAt: '2026-01-01T00:00:00Z',
  sections: [{paragraphs: ['SYNTHETIC fixture text']}],
})));
export const syntheticLegalReady = () => legalCheckoutReady(SYNTHETIC_APPROVED_LEGAL);
