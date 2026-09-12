-- S01: preserve all existing rows/grants; no SECURITY DEFINER or new privilege.
-- Lock namespace71820901 is shared by settings writers and ledger write authorization.
CREATE FUNCTION staff_settings_boundary() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(71820901,hashtext(NEW.id));
 RETURN NEW;
END $$;
CREATE TRIGGER staff_00_settings_boundary BEFORE UPDATE ON staff_members FOR EACH ROW
 WHEN ((NEW.active,NEW.role,NEW.scope,NEW.revision) IS DISTINCT FROM (OLD.active,OLD.role,OLD.scope,OLD.revision))
 EXECUTE FUNCTION staff_settings_boundary();
-- last_login_at / failure counters / password timestamps are not settings changes.
-- Name changes previously had no revision effect when all access arrays were empty.
CREATE FUNCTION staff_display_name_revision() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN
 UPDATE public.staff_members SET revision=revision+1 WHERE id=NEW.id;
 RETURN NULL;
END $$;
CREATE TRIGGER staff_display_name_revision AFTER UPDATE OF name ON auth_user FOR EACH ROW
 WHEN (NEW.name IS DISTINCT FROM OLD.name) EXECUTE FUNCTION staff_display_name_revision();
REVOKE ALL ON FUNCTION staff_settings_boundary(),staff_display_name_revision() FROM PUBLIC;
