import legal from '../../../../config/content/public-legal.json';
import type {Locale} from './public-pages';

/** Public legal/policy documents (JA/EN). Only an Owner-approved document is ever published; an unapproved one has no
 * page, no link and keeps the "under review" notices visible. The text itself is Owner-supplied content, not code. */
export const LEGAL_DOCS = ['terms', 'privacy', 'commercial-disclosure', 'cancellation'] as const;
export type LegalDoc = (typeof LEGAL_DOCS)[number];
export type LegalSection = {heading?: string; paragraphs: string[]};
export type LegalDocument = Readonly<{doc: LegalDoc; locale: Locale; title: string; approvedBy: string; approvedAt: string; sections: readonly LegalSection[]}>;
type Raw = {doc?: unknown; locale?: unknown; title?: unknown; state?: unknown; approvedBy?: unknown; approvedAt?: unknown; sections?: unknown};

const text = (v: unknown, max: number) => typeof v === 'string' && v.trim() !== '' && v.length <= max;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

/** Strict validation; anything incomplete is treated as NOT approved (fail closed). */
export function approvedLegalDocument(raw: Raw, now = Date.now()): LegalDocument | null {
  if (raw.state !== 'OWNER_APPROVED') return null;
  if (!LEGAL_DOCS.includes(raw.doc as LegalDoc) || (raw.locale !== 'ja' && raw.locale !== 'en')) return null;
  if (!text(raw.title, 120) || !text(raw.approvedBy, 120)) return null;
  if (typeof raw.approvedAt !== 'string' || !ISO.test(raw.approvedAt) || !(Date.parse(raw.approvedAt) <= now)) return null;
  if (!Array.isArray(raw.sections) || raw.sections.length === 0) return null;
  const sections: LegalSection[] = [];
  for (const s of raw.sections as {heading?: unknown; paragraphs?: unknown}[]) {
    if (!s || typeof s !== 'object' || (s.heading !== undefined && !text(s.heading, 200))) return null;
    if (!Array.isArray(s.paragraphs) || s.paragraphs.length === 0 || !s.paragraphs.every(p => text(p, 4000))) return null;
    sections.push(Object.freeze({...(s.heading !== undefined ? {heading: s.heading as string} : {}), paragraphs: [...(s.paragraphs as string[])]}));
  }
  return Object.freeze({doc: raw.doc as LegalDoc, locale: raw.locale as Locale, title: raw.title as string, approvedBy: raw.approvedBy as string, approvedAt: raw.approvedAt, sections: Object.freeze(sections)});
}

const documents = (legal as {documents: Raw[]}).documents;
/** A document is published only when BOTH its JA and EN versions are approved: a one-sided approval publishes neither. */
export function legalDocument(locale: Locale, doc: string, source: readonly Raw[] = documents): LegalDocument | null {
  const find = (l: Locale) => { const raw = source.find(d => d.locale === l && d.doc === doc); return raw ? approvedLegalDocument(raw) : null; };
  const other = locale === 'ja' ? 'en' : 'ja';
  const own = find(locale);
  return own && find(other) ? own : null;
}
export function approvedLegalDocs(locale: Locale, source: readonly Raw[] = documents): LegalDoc[] {
  return LEGAL_DOCS.filter(d => legalDocument(locale, d, source));
}
/** True only when every legal document is approved (in both locales): only then may the "under review" notices disappear. */
export function legalPublicationComplete(locale: Locale, source: readonly Raw[] = documents): boolean {
  return approvedLegalDocs(locale, source).length === LEGAL_DOCS.length;
}
export const legalPath = (doc: LegalDoc) => 'legal/' + doc;
/** Server-side gate for real (commercial) checkout: all four documents approved in JA and EN. */
export function legalCheckoutReady(source: readonly Raw[] = documents): boolean {
  return legalPublicationComplete('ja', source) && legalPublicationComplete('en', source);
}
