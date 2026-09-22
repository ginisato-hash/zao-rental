-- ZAO-PROD-R7-WEBHOOK-ROLES. Realizes the least-privilege receiver/reconciler roles that
-- migration 0025's own closing comment already described but never created. NOLOGIN: inert
-- until an operator separately runs ALTER ROLE ... LOGIN PASSWORD out of band, never in git.
-- Neither role gets table writes, DDL, ownership, role membership or any business-mutation
-- grant outside square_webhook's own three functions.
DO $$BEGIN
 IF current_database() !~ '^zr_[a-f0-9]{12}$' THEN RAISE EXCEPTION 'Dedicated development database required';END IF;
 EXECUTE format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS',current_database()||'_square_webhook_receiver');
 EXECUTE format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS',current_database()||'_square_webhook_reconciler');
 EXECUTE format('GRANT CONNECT ON DATABASE %I TO %I,%I',current_database(),current_database()||'_square_webhook_receiver',current_database()||'_square_webhook_reconciler');
 EXECUTE format('GRANT USAGE ON SCHEMA square_webhook TO %I,%I',current_database()||'_square_webhook_receiver',current_database()||'_square_webhook_reconciler');
 EXECUTE format('GRANT EXECUTE ON FUNCTION square_webhook.receive(text,text,text,text,text,text) TO %I',current_database()||'_square_webhook_receiver');
 EXECUTE format('GRANT EXECUTE ON FUNCTION square_webhook.claim(text,integer) TO %I',current_database()||'_square_webhook_reconciler');
 EXECUTE format('GRANT EXECUTE ON FUNCTION square_webhook.settle(text,text,uuid,text,text,integer) TO %I',current_database()||'_square_webhook_reconciler');
END$$;
