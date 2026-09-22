-- ZAO-PROD-R4-BACKUP-ROLE. Least-privilege read-only identity for a Production logical
-- backup (pg_dump -Fc --no-owner --no-acl); never a write/DDL/replication credential.
-- NOLOGIN: inert until an operator separately runs ALTER ROLE ... LOGIN PASSWORD out of
-- band. INHERIT so that, once flipped to LOGIN, its pg_read_all_data membership is active
-- on connection without a manual SET ROLE (pg_dump never issues one).
DO $$BEGIN
 IF current_database() !~ '^zr_[a-f0-9]{12}$' THEN RAISE EXCEPTION 'Dedicated development database required';END IF;
 EXECUTE format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS',current_database()||'_backup');
 EXECUTE format('GRANT CONNECT ON DATABASE %I TO %I',current_database(),current_database()||'_backup');
 EXECUTE format('GRANT pg_read_all_data TO %I',current_database()||'_backup');
END$$;
