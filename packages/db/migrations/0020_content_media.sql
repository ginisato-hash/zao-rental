-- Dedicated development media adapter; no external storage or publication grant.
CREATE TABLE content_media_objects(sha256 text PRIMARY KEY CHECK(sha256 ~ '^[a-f0-9]{64}$'),bytes bytea NOT NULL CHECK(octet_length(bytes) BETWEEN 1 AND 10485760));
CREATE TRIGGER content_media_immutable BEFORE UPDATE OR DELETE ON content_media_objects FOR EACH ROW EXECUTE FUNCTION pricing_immutable();
REVOKE ALL ON content_media_objects FROM PUBLIC;
CREATE FUNCTION content_access_lock() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$BEGIN
 PERFORM pg_advisory_xact_lock(71820901,hashtext(CASE WHEN TG_OP='DELETE' THEN OLD.staff_id ELSE NEW.staff_id END));
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;END$$;
CREATE TRIGGER content_access_serialized BEFORE INSERT OR UPDATE OR DELETE ON content_staff_access FOR EACH ROW EXECUTE FUNCTION content_access_lock();
REVOKE ALL ON FUNCTION content_access_lock() FROM PUBLIC;
