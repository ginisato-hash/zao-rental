-- Better Auth 1.7.4 PostgreSQL core schema, explicit model names; applied only by migrate().
CREATE TABLE auth_user (
 id text PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE CHECK(email=lower(btrim(email))), "emailVerified" boolean NOT NULL DEFAULT false,
 image text, "createdAt" timestamptz NOT NULL, "updatedAt" timestamptz NOT NULL
);
CREATE TABLE auth_session (
 id text PRIMARY KEY, "expiresAt" timestamptz NOT NULL, token text NOT NULL UNIQUE,
 "createdAt" timestamptz NOT NULL, "updatedAt" timestamptz NOT NULL, "ipAddress" text, "userAgent" text,
 "userId" text NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE
);
CREATE INDEX auth_session_user_idx ON auth_session("userId");
CREATE TABLE auth_account (
 id text PRIMARY KEY, "accountId" text NOT NULL, "providerId" text NOT NULL, "userId" text NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
 "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz,
 scope text, password text NOT NULL, "createdAt" timestamptz NOT NULL, "updatedAt" timestamptz NOT NULL,
 UNIQUE("providerId","accountId"), UNIQUE("userId","providerId"),
 CHECK("providerId"='credential' AND "accessToken" IS NULL AND "refreshToken" IS NULL AND "idToken" IS NULL AND password LIKE '$argon2id$%')
);
CREATE INDEX auth_account_user_idx ON auth_account("userId");
CREATE TABLE auth_verification (
 id text PRIMARY KEY, identifier text NOT NULL, value text NOT NULL, "expiresAt" timestamptz NOT NULL,
 "createdAt" timestamptz NOT NULL, "updatedAt" timestamptz NOT NULL
);
CREATE INDEX auth_verification_identifier_idx ON auth_verification(identifier);
-- App identity is separated from library-owned credentials. staff_users is the unified model.
CREATE TABLE staff_members (
 id text PRIMARY KEY REFERENCES auth_user(id), active boolean NOT NULL DEFAULT false,
 role text NOT NULL CHECK(role IN ('ADMIN','MANAGER','STAFF','VIEWER')),
 scope text NOT NULL CHECK(scope IN ('ALL','ASSIGNED')), revision integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 last_login_at timestamptz, password_changed_at timestamptz NOT NULL DEFAULT now(),
 failed_login_count integer NOT NULL DEFAULT 0 CHECK(failed_login_count>=0), locked_until timestamptz
);
CREATE TABLE staff_store_access (
 staff_id text NOT NULL REFERENCES staff_members(id), store_id text NOT NULL REFERENCES ledger_stores(id), PRIMARY KEY(staff_id,store_id)
);
CREATE TABLE staff_role_permissions (
 role text NOT NULL CHECK(role IN ('ADMIN','MANAGER','STAFF','VIEWER')),
 permission text NOT NULL CHECK(permission IN ('INVENTORY_VIEW','INVENTORY_EDIT','STAFF_MANAGE')), PRIMARY KEY(role,permission)
);
INSERT INTO staff_role_permissions VALUES
 ('ADMIN','INVENTORY_VIEW'),('ADMIN','INVENTORY_EDIT'),('ADMIN','STAFF_MANAGE'),
 ('MANAGER','INVENTORY_VIEW'),('MANAGER','INVENTORY_EDIT'),('STAFF','INVENTORY_VIEW'),('VIEWER','INVENTORY_VIEW');
CREATE TABLE staff_permission_overrides (
 staff_id text NOT NULL REFERENCES staff_members(id), permission text NOT NULL CHECK(permission IN ('INVENTORY_VIEW','INVENTORY_EDIT','STAFF_MANAGE')),
 allowed boolean NOT NULL, PRIMARY KEY(staff_id,permission)
);
-- Contains hashes: no runtime role is granted access to this operational model view.
CREATE VIEW staff_users AS SELECT m.id,u.email,a.password AS password_hash,u.name AS display_name,
 m.active,m.role,m.created_at,m.updated_at,m.last_login_at,m.password_changed_at,m.failed_login_count,m.locked_until
 FROM staff_members m JOIN auth_user u ON u.id=m.id JOIN auth_account a ON a."userId"=m.id AND a."providerId"='credential';
CREATE TABLE staff_audit (
 event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event text NOT NULL CHECK(event IN ('LOGIN_SUCCESS','LOGIN_FAILED','LOGOUT','PASSWORD_CHANGED','ACCOUNT_CREATED','ACCOUNT_DISABLED','ACCOUNT_ENABLED','ROLE_CHANGED','PERMISSION_CHANGED','STORE_ACCESS_CHANGED')),
 actor_staff_id text, target_staff_id text, occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION staff_log(kind text,actor text,target text) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 INSERT INTO public.staff_audit(event,actor_staff_id,target_staff_id) VALUES(kind,actor,target)
$$;
REVOKE ALL ON FUNCTION staff_log(text,text,text) FROM PUBLIC;
CREATE FUNCTION staff_guard_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor text:=nullif(current_setting('zao.staff_actor',true),'');
BEGIN
 IF TG_OP='INSERT' THEN PERFORM public.staff_log('ACCOUNT_CREATED',actor,NEW.id);
 ELSE
  NEW.updated_at:=clock_timestamp();
  IF (NEW.active,NEW.role,NEW.scope) IS DISTINCT FROM (OLD.active,OLD.role,OLD.scope) THEN NEW.revision:=OLD.revision+1; END IF;
  IF NEW.role<>OLD.role THEN PERFORM public.staff_log('ROLE_CHANGED',actor,NEW.id); END IF;
  IF NEW.scope<>OLD.scope THEN PERFORM public.staff_log('STORE_ACCESS_CHANGED',actor,NEW.id); END IF;
  IF NEW.active<>OLD.active THEN
   PERFORM public.staff_log(CASE WHEN NEW.active THEN 'ACCOUNT_ENABLED' ELSE 'ACCOUNT_DISABLED' END,actor,NEW.id);
   IF NOT NEW.active THEN DELETE FROM public.auth_session WHERE "userId"=NEW.id; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER staff_members_audit BEFORE INSERT OR UPDATE ON staff_members FOR EACH ROW EXECUTE FUNCTION staff_guard_audit();
CREATE FUNCTION staff_access_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE target text:=CASE WHEN TG_OP='DELETE' THEN OLD.staff_id ELSE NEW.staff_id END;
BEGIN
 UPDATE public.staff_members SET revision=revision+1 WHERE id=target;
 PERFORM public.staff_log(CASE WHEN TG_TABLE_NAME='staff_store_access' THEN 'STORE_ACCESS_CHANGED' ELSE 'PERMISSION_CHANGED' END,nullif(current_setting('zao.staff_actor',true),''),target);
 RETURN NULL;
END $$;
CREATE TRIGGER staff_store_audit AFTER INSERT OR UPDATE OR DELETE ON staff_store_access FOR EACH ROW EXECUTE FUNCTION staff_access_audit();
CREATE TRIGGER staff_permission_audit AFTER INSERT OR UPDATE OR DELETE ON staff_permission_overrides FOR EACH ROW EXECUTE FUNCTION staff_access_audit();
CREATE FUNCTION staff_password_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.password IS DISTINCT FROM OLD.password THEN
  UPDATE public.staff_members SET password_changed_at=clock_timestamp(),failed_login_count=0,locked_until=NULL WHERE id=NEW."userId";
  DELETE FROM public.auth_session WHERE "userId"=NEW."userId";
  PERFORM public.staff_log('PASSWORD_CHANGED',coalesce(nullif(current_setting('zao.staff_actor',true),''),NEW."userId"),NEW."userId");
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER staff_password_audit AFTER UPDATE ON auth_account FOR EACH ROW EXECUTE FUNCTION staff_password_audit();
ALTER FUNCTION ledger_audit() SECURITY DEFINER;
ALTER FUNCTION ledger_audit() SET search_path = pg_catalog, public;
REVOKE ALL ON FUNCTION ledger_audit() FROM PUBLIC;
REVOKE ALL ON FUNCTION staff_guard_audit(),staff_access_audit(),staff_password_audit() FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
