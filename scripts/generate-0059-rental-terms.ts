// Writes packages/db/migrations/0059_rental_terms_acceptance.sql from the committed legal content.
// Run once when the bundle is introduced; tests/unit/rental-terms.test.ts fails if the migration and content drift.
import {writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {rentalTermsCanonical, RENTAL_TERMS_VERSION, currentRentalTerms} from '../packages/core/src/content/rental-terms';

const canonical = rentalTermsCanonical();
const sha = createHash('sha256').update(canonical, 'utf8').digest('hex');
if (sha !== currentRentalTerms().sha256) throw new Error('HASH_MISMATCH');
if (canonical.includes('$terms$')) throw new Error('DELIMITER_IN_TEXT');
const sql = `-- 0059 rental terms bundle and per-booking acceptance (Issue #47, 2026-11-19). Additive only: 0001-0058 unchanged.
-- * rental_terms_bundles keeps each accepted JA/EN text bundle immutably; its SHA-256 is checked against the stored text.
-- * rental_terms_acceptances records, in the booking-creation transaction, which bundle the customer accepted, in which
--   locale, at the database server's time. The refund arithmetic (booking_cancellation_policies, ZAO_CANCELLATION_V1) is
--   separate and untouched; existing bookings get no acceptance row and keep the terms they were sold under.
-- * Authority: TD-adopted draft under the Owner's comprehensive instruction (Issue #47 comment 6984890289). It is not a
--   separate verbatim Owner sign-off or a lawyer review.
CREATE TABLE rental_terms_bundles(
 version text NOT NULL CHECK(version ~ '^ZAO_RENTAL_TERMS_V[0-9]+$'),
 sha256 text NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'),
 canonical text NOT NULL,
 authority text NOT NULL CHECK(length(authority) BETWEEN 1 AND 400),
 effective_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(version),
 UNIQUE(version,sha256),
 CHECK(sha256=encode(sha256(convert_to(canonical,'UTF8')),'hex'))
);
CREATE TRIGGER rental_terms_bundles_immutable BEFORE UPDATE OR DELETE ON rental_terms_bundles FOR EACH ROW EXECUTE FUNCTION pricing_immutable();
CREATE TABLE rental_terms_acceptances(
 booking_id uuid PRIMARY KEY REFERENCES rental_bookings(id),
 version text NOT NULL,
 sha256 text NOT NULL,
 locale text NOT NULL CHECK(locale IN ('ja','en')),
 accepted_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(version,sha256) REFERENCES rental_terms_bundles(version,sha256)
);
CREATE TRIGGER rental_terms_acceptances_immutable BEFORE UPDATE OR DELETE ON rental_terms_acceptances FOR EACH ROW EXECUTE FUNCTION pricing_immutable();
CREATE FUNCTION booking_record_terms_acceptance() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF jsonb_typeof(NEW.contact->'rentalTerms')='object' THEN
  INSERT INTO rental_terms_acceptances(booking_id,version,sha256,locale,accepted_at)
  VALUES(NEW.id,NEW.contact->'rentalTerms'->>'version',NEW.contact->'rentalTerms'->>'sha256',NEW.contact->'rentalTerms'->>'locale',now());
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION booking_record_terms_acceptance() FROM PUBLIC;
CREATE TRIGGER booking_record_terms_acceptance AFTER INSERT ON rental_bookings FOR EACH ROW EXECUTE FUNCTION booking_record_terms_acceptance();
INSERT INTO rental_terms_bundles(version,sha256,canonical,authority) VALUES(
 '${RENTAL_TERMS_VERSION}',
 '${sha}',
 $terms$${canonical}$terms$,
 'TD adoption under Owner comprehensive instruction, Issue #47 comment 6984890289 (2026-11-18T16:35:58Z); not a separate verbatim Owner sign-off'
);
`;
writeFileSync(new URL('../packages/db/migrations/0059_rental_terms_acceptance.sql', import.meta.url), sql);
console.log(sha);
