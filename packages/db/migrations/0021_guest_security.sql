CREATE TABLE guest_policy_versions(version text PRIMARY KEY,fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),parameters jsonb NOT NULL);
-- P1 dedicated-development verification; production application is a separate release decision.
CREATE TABLE guest_lifecycle(
 context_id uuid PRIMARY KEY REFERENCES guest_contexts(id),policy_version text NOT NULL REFERENCES guest_policy_versions(version),
 absolute_at timestamptz NOT NULL,revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 recovery_hash text UNIQUE CHECK(recovery_hash ~ '^[a-f0-9]{64}$'),recovery_until timestamptz,
 retained_at timestamptz,
 replay_hash text UNIQUE CHECK(replay_hash ~ '^[a-f0-9]{64}$'),replay_request uuid,replay_until timestamptz,
 CHECK((recovery_hash IS NULL)=(recovery_until IS NULL)));
CREATE TABLE guest_rate_buckets(bucket text PRIMARY KEY CHECK(length(bucket)<180),count integer NOT NULL CHECK(count>0),expires_at timestamptz NOT NULL);
CREATE INDEX guest_rate_expiry ON guest_rate_buckets(expires_at);
CREATE TABLE guest_security_audit(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,context_id uuid REFERENCES guest_contexts(id),action text NOT NULL CHECK(action IN ('RECOVERY_ENROLLED','CONTEXT_RECOVERED','DRAFT_REDACTED')),created_at timestamptz NOT NULL DEFAULT clock_timestamp());
REVOKE ALL ON guest_lifecycle,guest_rate_buckets,guest_security_audit FROM PUBLIC;
REVOKE ALL ON guest_policy_versions FROM PUBLIC;
