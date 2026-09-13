-- New isolated content records, no CMS grant to price or physical stock.
DO $$BEGIN IF current_database() !~ '^zr_[a-f0-9]{12}$' THEN RAISE EXCEPTION 'Dedicated development DB required';END IF;END$$;
CREATE TABLE content_workspace(id boolean PRIMARY KEY DEFAULT true CHECK(id),revision integer NOT NULL DEFAULT 1 CHECK(revision>0),value jsonb NOT NULL CHECK(jsonb_typeof(value)='object'));
CREATE TABLE content_revision_records(id uuid PRIMARY KEY,payload jsonb NOT NULL);
CREATE TABLE content_audit_records(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,actor text NOT NULL REFERENCES staff_members(id),action text NOT NULL,object_id text NOT NULL,before_id text,after_id text);
CREATE TABLE content_outbox(release_id uuid PRIMARY KEY,event text NOT NULL CHECK(event='PRIVATE_PREVIEW_CHANGED'));
CREATE TABLE content_staff_access(staff_id text NOT NULL REFERENCES staff_members(id),permission text NOT NULL CHECK(permission IN ('CONTENT_EDIT','CONTENT_BULK','CONTENT_PUBLISH')),PRIMARY KEY(staff_id,permission));
CREATE TABLE content_model_previews(slug text PRIMARY KEY CHECK(slug ~ '^[a-z0-9][a-z0-9-]{0,79}$'),model_id uuid NOT NULL REFERENCES ledger_models(id),season text NOT NULL,variant_ids uuid[] NOT NULL CHECK(cardinality(variant_ids)>0 AND cardinality(variant_ids)<=32),revision integer NOT NULL CHECK(revision>0),state text NOT NULL CHECK(state IN ('DRAFT','PREVIEW_APPROVED','WITHDRAWN')),translation_approved boolean NOT NULL DEFAULT false,shop_verified boolean NOT NULL DEFAULT false,rights_verified boolean NOT NULL DEFAULT false,rights_until timestamptz,content jsonb NOT NULL,media jsonb NOT NULL);
CREATE TABLE content_public_policies(id text PRIMARY KEY CHECK(id='latePickupPolicy'),revision integer NOT NULL CHECK(revision>0),ja text NOT NULL,en text NOT NULL,wording_state text NOT NULL CHECK(wording_state='DRAFT_WORDING_REQUIRES_PUBLICATION_REVIEW'));
CREATE TRIGGER content_revisions_immutable BEFORE UPDATE OR DELETE ON content_revision_records FOR EACH ROW EXECUTE FUNCTION pricing_immutable();
CREATE TRIGGER content_audit_immutable BEFORE UPDATE OR DELETE ON content_audit_records FOR EACH ROW EXECUTE FUNCTION pricing_immutable();
CREATE TRIGGER content_outbox_immutable BEFORE UPDATE OR DELETE ON content_outbox FOR EACH ROW EXECUTE FUNCTION pricing_immutable();
REVOKE ALL ON content_workspace,content_revision_records,content_audit_records,content_outbox,content_staff_access,content_model_previews,content_public_policies FROM PUBLIC;
