-- R13 LOCAL only. Additive projection journal; no role/grant/apply/runtime activation.
CREATE SCHEMA payment_projection;
REVOKE ALL ON SCHEMA payment_projection FROM PUBLIC;
CREATE TABLE payment_projection.heads(
 attempt_id uuid PRIMARY KEY REFERENCES rental_payment_attempts(id),revision integer NOT NULL CHECK(revision>0),last_observation jsonb CHECK(last_observation IS NULL OR payment_reconciliation.valid_observation(last_observation))
);
CREATE TABLE payment_projection.events(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 booking_id uuid NOT NULL REFERENCES rental_bookings(id),attempt_id uuid NOT NULL REFERENCES rental_payment_attempts(id),
 job_id uuid NOT NULL REFERENCES payment_reconciliation.jobs(id),provider_id text NOT NULL CHECK(provider_id ~ '^[A-Za-z0-9_-]{1,100}$'),provider_updated_at timestamptz NOT NULL,
 observation_fingerprint text NOT NULL CHECK(observation_fingerprint ~ '^[a-f0-9]{64}$'),truth_fingerprint text NOT NULL CHECK(truth_fingerprint ~ '^[a-f0-9]{64}$'),
 decision_fingerprint text NOT NULL CHECK(decision_fingerprint ~ '^[a-f0-9]{64}$'),
 decision text NOT NULL CHECK(decision IN ('NOOP_DUPLICATE','NOOP_STALE','NOOP_TERMINAL','KEEP_PENDING','APPLY_COMPLETED','APPLY_FAILED','APPLY_CANCELED','BLOCK_EXPIRED_HOLD','BLOCK_INVENTORY_DRIFT','BLOCK_TRANSFER_ATTENTION','BLOCK_PRICE_INTEGRITY','BLOCK_IDENTITY_MISMATCH','BLOCK_INVALID_TRANSITION','BLOCK_CONFLICT','BLOCK_SOURCE','REQUIRES_OPERATOR_RECONCILIATION')),
 revision integer NOT NULL CHECK(revision>0),observation jsonb CHECK(observation IS NULL OR payment_reconciliation.valid_observation(observation)),
 previous_state jsonb NOT NULL,new_state jsonb NOT NULL,operator_required boolean NOT NULL,result jsonb NOT NULL,occurred_at timestamptz NOT NULL,
 origin text NOT NULL DEFAULT 'INTERNAL_LOCAL_PROJECTION' CHECK(origin='INTERNAL_LOCAL_PROJECTION'),
 UNIQUE(attempt_id,observation_fingerprint),UNIQUE(attempt_id,revision),
 CHECK(operator_required=(decision LIKE 'BLOCK_%' OR decision='REQUIRES_OPERATOR_RECONCILIATION')),
 CHECK((previous_state ?& ARRAY['booking','attempt','hold','holdPayment'] AND previous_state-ARRAY['booking','attempt','hold','holdPayment']='{}'::jsonb) IS TRUE),
 CHECK((new_state ?& ARRAY['booking','attempt','hold','holdPayment'] AND new_state-ARRAY['booking','attempt','hold','holdPayment']='{}'::jsonb) IS TRUE),
 CHECK((result ?& ARRAY['bookingId','attemptId','revision','decision','decisionFingerprint','observationFingerprint','providerStatus','bookingState','attemptState','operatorActionRequired','duplicate']
 AND result-ARRAY['bookingId','attemptId','revision','decision','decisionFingerprint','observationFingerprint','providerStatus','bookingState','attemptState','operatorActionRequired','duplicate']='{}'::jsonb) IS TRUE),
 CHECK((result->>'bookingId'=booking_id::text AND result->>'attemptId'=attempt_id::text AND result->>'revision'=revision::text AND result->>'decision'=decision AND result->'duplicate'='false'::jsonb AND result->>'decisionFingerprint'=decision_fingerprint AND result->>'observationFingerprint'=observation_fingerprint AND result->'operatorActionRequired'=to_jsonb(operator_required)) IS TRUE)
);
CREATE INDEX payment_projection_booking ON payment_projection.events(booking_id,id);
CREATE TABLE payment_projection.job_receipts(
 job_id uuid NOT NULL REFERENCES payment_reconciliation.jobs(id),attempt_id uuid NOT NULL,
 observation_fingerprint text NOT NULL,
 PRIMARY KEY(job_id,attempt_id,observation_fingerprint),
 FOREIGN KEY(attempt_id,observation_fingerprint) REFERENCES payment_projection.events(attempt_id,observation_fingerprint)
);
CREATE TRIGGER payment_projection_immutable BEFORE UPDATE OR DELETE ON payment_projection.events FOR EACH ROW EXECUTE FUNCTION pricing_immutable();
CREATE TRIGGER payment_projection_receipt_immutable BEFORE UPDATE OR DELETE ON payment_projection.job_receipts FOR EACH ROW EXECUTE FUNCTION pricing_immutable();
REVOKE ALL ON ALL TABLES IN SCHEMA payment_projection FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA payment_projection FROM PUBLIC;
-- No new business states, automatic release/reacquisition, notifications, credential or provider operation.
-- Rollback is disable consumers and retain journal; applied files are never rewritten.
