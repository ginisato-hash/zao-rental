import {createHash} from 'node:crypto';
import legal from '../../../../config/content/public-legal.json';

/** Rental terms bundle a customer accepts before payment (Issue #47, 2026-11-19).
 * The bundle is the published JA and EN text of the rental terms and the cancellation policy. Its version is separate
 * from the cancellation arithmetic: the 48-hour refund rule stays ZAO_CANCELLATION_V1 and its per-booking snapshot (0045)
 * is not touched. The canonical text below is also stored immutably by migration 0059; a unit test keeps the two equal. */
export const RENTAL_TERMS_VERSION = 'ZAO_RENTAL_TERMS_V2' as const;
export const RENTAL_TERMS_DOCS = ['terms', 'cancellation'] as const;
export type RentalTermsRef = Readonly<{version: string; sha256: string}>;
type RawSection = {heading?: string; paragraphs: string[]};
type RawDoc = {doc: string; locale: string; title: string; sections: RawSection[]};

export function rentalTermsCanonical(source: readonly RawDoc[] = (legal as unknown as {documents: RawDoc[]}).documents): string {
  const documents = RENTAL_TERMS_DOCS.flatMap(doc => (['ja', 'en'] as const).map(locale => {
    const d = source.find(x => x.doc === doc && x.locale === locale);
    if (!d) throw new Error('RENTAL_TERMS_DOCUMENT_MISSING');
    return {doc, locale, title: d.title, sections: d.sections.map(s => ({heading: s.heading ?? null, paragraphs: [...s.paragraphs]}))};
  }));
  return JSON.stringify({version: RENTAL_TERMS_VERSION, documents});
}

let cached: RentalTermsRef | undefined;
/** The version and SHA-256 of the bundle a new payment must be accepted against. */
export function currentRentalTerms(): RentalTermsRef {
  return cached ??= Object.freeze({version: RENTAL_TERMS_VERSION, sha256: createHash('sha256').update(rentalTermsCanonical(), 'utf8').digest('hex')});
}
