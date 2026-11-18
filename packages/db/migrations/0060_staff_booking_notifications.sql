-- 0060 staff new-booking notifications (Issue #47 §6, 2026-11-19). Additive only: 0001-0059 unchanged.
-- * staff_booking_events: one durable row per booking and kind, written in the transaction that makes the booking
--   CONFIRMED (or PAYMENT_REVIEW). Opening a list never acknowledges; acknowledgement is one shared server record
--   (who, when) per event, so every device sees the same state and a later page limit cannot drop an unacknowledged row.
-- * staff_notification_recipients: a staff member opts in for themself (their own login address, chosen while signed in).
--   Addresses are never guessed from names or public contacts. Customers' outbox (recipient = booking) is untouched.
-- * staff_notification_outbox: per event and recipient, the same lease / bounded retry / UNKNOWN-lookup model as
--   booking_notification_outbox. Email failure never rolls back a booking: capture is guarded and resynchronized.
-- * Bookings confirmed before this migration are imported once as HISTORY_IMPORT (upcoming only) with no email.
CREATE TABLE staff_booking_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 booking_id uuid NOT NULL REFERENCES rental_bookings(id),
 kind text NOT NULL CHECK(kind IN ('BOOKING_CONFIRMED','PAYMENT_REVIEW')),
 store_id text NOT NULL REFERENCES ledger_stores(id),
 return_store_id text NOT NULL REFERENCES ledger_stores(id),
 source text NOT NULL CHECK(source IN ('LIVE','HISTORY_IMPORT')),
 created_at timestamptz NOT NULL DEFAULT inventory_clock(),
 acknowledged_by text REFERENCES staff_members(id),
 acknowledged_at timestamptz,
 UNIQUE(booking_id,kind),
 CHECK((acknowledged_by IS NULL)=(acknowledged_at IS NULL))
);
CREATE INDEX staff_booking_events_open ON staff_booking_events(created_at DESC,id DESC) WHERE acknowledged_at IS NULL;
CREATE INDEX staff_booking_events_recent ON staff_booking_events(created_at DESC,id DESC);
REVOKE ALL ON staff_booking_events FROM PUBLIC;
-- Only the single acknowledgement transition may change a row; nothing is deleted.
CREATE FUNCTION staff_booking_events_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'STAFF_EVENT_IMMUTABLE' USING ERRCODE='23514';END IF;
 IF OLD.acknowledged_at IS NOT NULL OR NEW.acknowledged_at IS NULL OR (to_jsonb(NEW)-'acknowledged_by'-'acknowledged_at')<>(to_jsonb(OLD)-'acknowledged_by'-'acknowledged_at') THEN RAISE EXCEPTION 'STAFF_EVENT_IMMUTABLE' USING ERRCODE='23514';END IF;
 RETURN NEW;
END$$;
CREATE TRIGGER staff_booking_events_guard BEFORE UPDATE OR DELETE ON staff_booking_events FOR EACH ROW EXECUTE FUNCTION staff_booking_events_guard();

CREATE TABLE staff_notification_recipients(
 staff_id text PRIMARY KEY REFERENCES staff_members(id),
 email_enabled boolean NOT NULL,
 locale text NOT NULL DEFAULT 'ja' CHECK(locale IN ('ja','en')),
 updated_at timestamptz NOT NULL DEFAULT inventory_clock()
);
REVOKE ALL ON staff_notification_recipients FROM PUBLIC;

CREATE TABLE staff_notification_outbox(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 event_id uuid NOT NULL REFERENCES staff_booking_events(id),
 staff_id text NOT NULL REFERENCES staff_members(id),
 dedupe_key text NOT NULL UNIQUE CHECK(length(dedupe_key) BETWEEN 1 AND 180),
 locale text NOT NULL CHECK(locale IN ('ja','en')),
 template_version text NOT NULL CHECK(template_version='STAFF_BOOKING_NOTIFICATION_V1'),
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','SENDING','SENT','RETRYABLE_FAILURE','PERMANENT_FAILURE','SUPPRESSED','UNKNOWN')),
 attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 3),
 next_attempt_at timestamptz,
 claim_id uuid,claim_until timestamptz,
 provider_message_id text CHECK(provider_message_id ~ '^[-A-Za-z0-9_]{1,128}$'),
 created_at timestamptz NOT NULL DEFAULT inventory_clock(),
 sent_at timestamptz,
 last_safe_failure_code text NOT NULL DEFAULT 'NONE' CHECK(last_safe_failure_code IN ('NONE','RATE_LIMITED','PROVIDER_UNAVAILABLE','PERMANENT_REJECT','ACCEPTANCE_UNKNOWN','RETRY_EXHAUSTED','TEMPLATE_UNAVAILABLE','RECIPIENT_UNAVAILABLE')),
 UNIQUE(event_id,staff_id),
 CHECK((status='SENDING')=(claim_id IS NOT NULL AND claim_until IS NOT NULL)),
 CHECK((claim_id IS NULL)=(claim_until IS NULL)),
 CHECK((status='SENT')=(sent_at IS NOT NULL)),
 CHECK(status<>'SENT' OR provider_message_id IS NOT NULL)
);
CREATE INDEX staff_notification_due ON staff_notification_outbox(next_attempt_at,id) WHERE status IN ('PENDING','RETRYABLE_FAILURE','UNKNOWN','SENDING');
REVOKE ALL ON staff_notification_outbox FROM PUBLIC;

-- Effective permission and store reach, matching ops_assert_actor without needing a session (recipient selection only).
CREATE FUNCTION staff_can_view_store(p_staff text,p_store text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT coalesce((SELECT m.active AND (m.scope='ALL' OR EXISTS(SELECT 1 FROM staff_store_access a WHERE a.staff_id=m.id AND a.store_id=p_store))
  AND NOT EXISTS(SELECT 1 FROM staff_permission_overrides o WHERE o.staff_id=m.id AND o.permission='BOOKING_VIEW' AND NOT o.allowed)
  AND (EXISTS(SELECT 1 FROM staff_permission_overrides o WHERE o.staff_id=m.id AND o.permission='BOOKING_VIEW' AND o.allowed) OR EXISTS(SELECT 1 FROM staff_role_permissions r WHERE r.role=m.role AND r.permission='BOOKING_VIEW'))
  FROM staff_members m WHERE m.id=p_staff),false)
$$;
REVOKE ALL ON FUNCTION staff_can_view_store(text,text) FROM PUBLIC;

-- Records the event (idempotent) and, for a LIVE confirmation, queues one email per opted-in recipient able to see a store.
CREATE FUNCTION staff_event_record(p_booking uuid,p_kind text,p_source text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$DECLARE b rental_bookings;e uuid;t timestamptz;BEGIN
 SELECT * INTO b FROM rental_bookings WHERE id=p_booking;IF NOT FOUND THEN RETURN NULL;END IF;t:=inventory_clock();
 INSERT INTO staff_booking_events(booking_id,kind,store_id,return_store_id,source,created_at)
 VALUES(b.id,p_kind,b.conditions->>'pickupStore',b.conditions->>'returnStore',p_source,t) ON CONFLICT(booking_id,kind) DO NOTHING RETURNING id INTO e;
 IF e IS NULL OR p_kind<>'BOOKING_CONFIRMED' OR p_source<>'LIVE' THEN RETURN e;END IF;
 INSERT INTO staff_notification_outbox(event_id,staff_id,dedupe_key,locale,template_version,next_attempt_at,created_at)
 SELECT e,r.staff_id,'staff-booking:'||e||':'||r.staff_id,r.locale,'STAFF_BOOKING_NOTIFICATION_V1',t,t FROM staff_notification_recipients r
  WHERE r.email_enabled AND (staff_can_view_store(r.staff_id,b.conditions->>'pickupStore') OR staff_can_view_store(r.staff_id,b.conditions->>'returnStore'))
 ON CONFLICT DO NOTHING;
 RETURN e;
END$$;
REVOKE ALL ON FUNCTION staff_event_record(uuid,text,text) FROM PUBLIC;

-- Capture never blocks or rolls back the booking transition; a missed capture is recovered by staff_events_sync().
CREATE FUNCTION staff_event_capture() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$BEGIN
 BEGIN
  IF booking_is_confirmed(NEW.mode,NEW.state) AND NEW.confirmed_at IS NOT NULL THEN PERFORM staff_event_record(NEW.id,'BOOKING_CONFIRMED','LIVE');
  ELSIF NEW.state='PAYMENT_REVIEW' THEN PERFORM staff_event_record(NEW.id,'PAYMENT_REVIEW','LIVE');END IF;
 EXCEPTION WHEN OTHERS THEN RAISE WARNING 'STAFF_EVENT_CAPTURE_DEFERRED';
 END;
 RETURN NEW;
END$$;
REVOKE ALL ON FUNCTION staff_event_capture() FROM PUBLIC;
CREATE TRIGGER staff_event_capture AFTER INSERT OR UPDATE OF state ON rental_bookings FOR EACH ROW EXECUTE FUNCTION staff_event_capture();

-- Live capture starts now. Anything confirmed later but missed is resynchronized as LIVE (with email); never older rows.
CREATE TABLE staff_notification_epoch(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),started_at timestamptz NOT NULL);
INSERT INTO staff_notification_epoch(started_at) VALUES(inventory_clock());
REVOKE ALL ON staff_notification_epoch FROM PUBLIC;
CREATE FUNCTION staff_events_sync() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$DECLARE n integer:=0;b record;BEGIN
 FOR b IN SELECT r.id FROM rental_bookings r WHERE booking_is_confirmed(r.mode,r.state) AND r.confirmed_at>=(SELECT started_at FROM staff_notification_epoch)
  AND NOT EXISTS(SELECT 1 FROM staff_booking_events e WHERE e.booking_id=r.id AND e.kind='BOOKING_CONFIRMED') ORDER BY r.confirmed_at LIMIT 100 LOOP
  PERFORM staff_event_record(b.id,'BOOKING_CONFIRMED','LIVE');n:=n+1;
 END LOOP;RETURN n;
END$$;
REVOKE ALL ON FUNCTION staff_events_sync() FROM PUBLIC;

-- History import: upcoming confirmed bookings appear in the inbox once, clearly marked, and never emailed.
INSERT INTO staff_booking_events(booking_id,kind,store_id,return_store_id,source)
SELECT b.id,'BOOKING_CONFIRMED',b.conditions->>'pickupStore',b.conditions->>'returnStore','HISTORY_IMPORT' FROM rental_bookings b
 WHERE booking_is_confirmed(b.mode,b.state) AND b.confirmed_at IS NOT NULL AND (b.conditions->'period'->>'startDate')::date>=(inventory_clock() AT TIME ZONE 'Asia/Tokyo')::date;

-- Inbox read for one signed-in staff member. Every requested store must be visible to the actor (ops_assert_actor), so
-- no customer data from another store can be returned. Keyset paging; counts are exact, not limited to the page.
CREATE FUNCTION staff_inbox_list(p_stores text[],p_open_only boolean,p_before timestamptz,p_before_id uuid,p_limit integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$DECLARE result jsonb;BEGIN
 IF p_stores IS NULL OR cardinality(p_stores) NOT BETWEEN 1 AND 4 OR p_limit NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'STAFF_INBOX_INPUT' USING ERRCODE='22023';END IF;
 PERFORM ops_assert_actor('BOOKING_VIEW',p_stores,current_setting('zao.actor',true));
 WITH visible AS (SELECT e.* FROM staff_booking_events e WHERE e.store_id=ANY(p_stores) OR e.return_store_id=ANY(p_stores)),
 page AS (SELECT v.* FROM visible v WHERE (NOT p_open_only OR v.acknowledged_at IS NULL) AND (p_before IS NULL OR (v.created_at,v.id)<(p_before,p_before_id)) ORDER BY v.created_at DESC,v.id DESC LIMIT p_limit)
 SELECT jsonb_build_object(
  'unacknowledged',(SELECT count(*) FROM visible WHERE acknowledged_at IS NULL AND kind='BOOKING_CONFIRMED'),
  'attention',(SELECT count(*) FROM visible WHERE acknowledged_at IS NULL AND kind='PAYMENT_REVIEW'),
  'total',(SELECT count(*) FROM visible WHERE NOT p_open_only OR acknowledged_at IS NULL),
  'latest',(SELECT max(created_at) FROM visible),
  'items',coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'bookingId',p.booking_id,'kind',p.kind,'source',p.source,'store',p.store_id,'returnStore',p.return_store_id,'createdAt',p.created_at,
    'acknowledgedAt',p.acknowledged_at,'acknowledgedBy',(SELECT u.name FROM auth_user u WHERE u.id=p.acknowledged_by),
    'state',b.state,'startDate',b.conditions->'period'->>'startDate','endDate',b.conditions->'period'->>'endDate','slot',b.conditions->'period'->>'slot',
    'people',jsonb_array_length(coalesce(b.conditions->'members','[]'::jsonb)),'customer',b.contact->>'displayName','totalJpy',(b.price_snapshot->>'totalJpy')::bigint) ORDER BY p.created_at DESC,p.id DESC)
   FROM page p JOIN rental_bookings b ON b.id=p.booking_id),'[]'::jsonb)) INTO result;
 RETURN result;
END$$;
REVOKE ALL ON FUNCTION staff_inbox_list(text[],boolean,timestamptz,uuid,integer) FROM PUBLIC;

-- Acknowledge once. Concurrent acknowledgements resolve to the first; the result is the stored (who, when).
CREATE FUNCTION staff_inbox_ack(p_event uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$DECLARE e staff_booking_events;BEGIN
 SELECT * INTO e FROM staff_booking_events WHERE id=p_event FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'STAFF_EVENT_NOT_FOUND' USING ERRCODE='42501';END IF;
 PERFORM ops_assert_actor('BOOKING_VIEW',ARRAY[e.store_id],current_setting('zao.actor',true));
 IF e.acknowledged_at IS NULL THEN UPDATE staff_booking_events SET acknowledged_by=current_setting('zao.actor'),acknowledged_at=inventory_clock() WHERE id=e.id RETURNING * INTO e;END IF;
 RETURN jsonb_build_object('id',e.id,'acknowledgedAt',e.acknowledged_at,'acknowledgedBy',(SELECT u.name FROM auth_user u WHERE u.id=e.acknowledged_by));
END$$;
REVOKE ALL ON FUNCTION staff_inbox_ack(uuid) FROM PUBLIC;

-- Self-service opt-in: only the signed-in staff member's own row, with a live session.
CREATE FUNCTION staff_notification_preference(p_enabled boolean,p_locale text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$DECLARE actor text:=current_setting('zao.actor',true);r staff_notification_recipients;BEGIN
 PERFORM 1 FROM auth_session WHERE id=current_setting('zao.session',true) AND "userId"=actor AND "expiresAt">clock_timestamp();
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM staff_members WHERE id=actor AND active) THEN RAISE EXCEPTION 'OPS_SESSION_INVALID' USING ERRCODE='42501';END IF;
 IF p_enabled IS NOT NULL THEN
  IF p_locale NOT IN ('ja','en') THEN RAISE EXCEPTION 'STAFF_INBOX_INPUT' USING ERRCODE='22023';END IF;
  INSERT INTO staff_notification_recipients(staff_id,email_enabled,locale,updated_at) VALUES(actor,p_enabled,p_locale,inventory_clock())
  ON CONFLICT(staff_id) DO UPDATE SET email_enabled=EXCLUDED.email_enabled,locale=EXCLUDED.locale,updated_at=EXCLUDED.updated_at;
 END IF;
 SELECT * INTO r FROM staff_notification_recipients WHERE staff_id=actor;
 RETURN jsonb_build_object('emailEnabled',coalesce(r.email_enabled,false),'locale',coalesce(r.locale,'ja'),'email',(SELECT email FROM auth_user WHERE id=actor));
END$$;
REVOKE ALL ON FUNCTION staff_notification_preference(boolean,text) FROM PUBLIC;

-- Delivery bookkeeping, same semantics as notification_claim/settle/unknown/reconciled/due.
CREATE FUNCTION staff_notification_claim(p_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$DECLARE o staff_notification_outbox;t timestamptz;BEGIN
 SELECT * INTO o FROM staff_notification_outbox WHERE id=p_id FOR UPDATE;IF NOT FOUND THEN RETURN NULL;END IF;t:=inventory_clock();
 IF o.status='SENDING' AND o.claim_until<=t THEN UPDATE staff_notification_outbox SET status='UNKNOWN',last_safe_failure_code='ACCEPTANCE_UNKNOWN',claim_id=NULL,claim_until=NULL,next_attempt_at=NULL WHERE id=o.id;RETURN NULL;END IF;
 IF o.status NOT IN ('PENDING','RETRYABLE_FAILURE') OR o.attempt_count>=3 OR o.next_attempt_at IS NULL OR o.next_attempt_at>t THEN RETURN NULL;END IF;
 UPDATE staff_notification_outbox SET status='SENDING',attempt_count=attempt_count+1,claim_id=gen_random_uuid(),claim_until=t+interval '1 minute',next_attempt_at=NULL,last_safe_failure_code='NONE' WHERE id=o.id RETURNING * INTO o;
 RETURN jsonb_build_object('id',o.id,'claimId',o.claim_id,'dedupeKey',o.dedupe_key);
END$$;
-- The recipient is re-checked at send time: a disabled, removed or out-of-scope staff member receives nothing.
CREATE FUNCTION staff_notification_material(p_id uuid,p_claim uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$DECLARE o staff_notification_outbox;e staff_booking_events;b rental_bookings;BEGIN
 SELECT * INTO o FROM staff_notification_outbox WHERE id=p_id AND status='SENDING' AND claim_id=p_claim AND claim_until>inventory_clock();IF NOT FOUND THEN RETURN NULL;END IF;
 SELECT * INTO e FROM staff_booking_events WHERE id=o.event_id;SELECT * INTO b FROM rental_bookings WHERE id=e.booking_id;
 IF NOT EXISTS(SELECT 1 FROM staff_notification_recipients r WHERE r.staff_id=o.staff_id AND r.email_enabled) OR NOT (staff_can_view_store(o.staff_id,e.store_id) OR staff_can_view_store(o.staff_id,e.return_store_id)) THEN
  RETURN jsonb_build_object('recipient',NULL);
 END IF;
 RETURN jsonb_build_object('id',o.id,'locale',o.locale,'bookingId',b.id,'recipient',(SELECT email FROM auth_user WHERE id=o.staff_id),'store',e.store_id,'returnStore',e.return_store_id,
  'startDate',b.conditions->'period'->>'startDate','endDate',b.conditions->'period'->>'endDate','slot',b.conditions->'period'->>'slot','people',jsonb_array_length(coalesce(b.conditions->'members','[]'::jsonb)));
END$$;
CREATE FUNCTION staff_notification_settle(p_id uuid,p_claim uuid,p_result text,p_provider text,p_failure text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$DECLARE o staff_notification_outbox;t timestamptz;new_status text;BEGIN
 SELECT * INTO o FROM staff_notification_outbox WHERE id=p_id FOR UPDATE;IF NOT FOUND OR o.status<>'SENDING' OR o.claim_id IS DISTINCT FROM p_claim THEN RETURN false;END IF;t:=inventory_clock();
 IF p_result='ACCEPTED' AND p_provider ~ '^[-A-Za-z0-9_]{1,128}$' THEN new_status:='SENT';p_failure:='NONE';
 ELSIF p_result='NOT_ACCEPTED' AND p_failure IN ('RATE_LIMITED','PROVIDER_UNAVAILABLE') THEN new_status:=CASE WHEN o.attempt_count>=3 THEN 'PERMANENT_FAILURE' ELSE 'RETRYABLE_FAILURE' END;IF o.attempt_count>=3 THEN p_failure:='RETRY_EXHAUSTED';END IF;
 ELSIF p_result='REJECTED' AND p_failure='PERMANENT_REJECT' THEN new_status:='PERMANENT_FAILURE';
 ELSIF p_result='SUPPRESSED' AND p_failure IN ('TEMPLATE_UNAVAILABLE','RECIPIENT_UNAVAILABLE') THEN new_status:='SUPPRESSED';
 ELSE new_status:='UNKNOWN';p_failure:='ACCEPTANCE_UNKNOWN';END IF;
 UPDATE staff_notification_outbox SET status=new_status,claim_id=NULL,claim_until=NULL,provider_message_id=CASE WHEN new_status='SENT' THEN p_provider ELSE NULL END,sent_at=CASE WHEN new_status='SENT' THEN t ELSE NULL END,
  next_attempt_at=CASE WHEN new_status='RETRYABLE_FAILURE' THEN t+(power(2,o.attempt_count)*interval '1 minute') WHEN new_status='UNKNOWN' THEN t+interval '1 minute' ELSE NULL END,last_safe_failure_code=p_failure WHERE id=o.id;
 RETURN true;
END$$;
CREATE FUNCTION staff_notification_unknown(p_id uuid) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$DECLARE o staff_notification_outbox;BEGIN
 SELECT * INTO o FROM staff_notification_outbox WHERE id=p_id FOR UPDATE;IF NOT FOUND THEN RETURN NULL;END IF;
 IF o.status='SENDING' AND o.claim_until<=inventory_clock() THEN UPDATE staff_notification_outbox SET status='UNKNOWN',claim_id=NULL,claim_until=NULL,last_safe_failure_code='ACCEPTANCE_UNKNOWN' WHERE id=o.id;o.status:='UNKNOWN';END IF;
 IF o.status='UNKNOWN' AND (o.next_attempt_at IS NULL OR o.next_attempt_at<=inventory_clock()) THEN UPDATE staff_notification_outbox SET next_attempt_at=inventory_clock()+interval '10 minutes' WHERE id=o.id;RETURN o.dedupe_key;END IF;RETURN NULL;
END$$;
CREATE FUNCTION staff_notification_reconciled(p_id uuid,p_provider text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$BEGIN
 IF p_provider IS NULL OR p_provider !~ '^[-A-Za-z0-9_]{1,128}$' THEN RETURN false;END IF;
 UPDATE staff_notification_outbox SET status='SENT',sent_at=inventory_clock(),provider_message_id=p_provider,next_attempt_at=NULL,last_safe_failure_code='NONE' WHERE id=p_id AND status='UNKNOWN';RETURN FOUND;
END$$;
CREATE FUNCTION staff_notification_due(p_limit integer) RETURNS TABLE(id uuid,action text) LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT o.id,CASE WHEN o.status IN ('UNKNOWN','SENDING') THEN 'LOOKUP' ELSE 'SEND' END FROM staff_notification_outbox o
 WHERE o.status IN ('PENDING','RETRYABLE_FAILURE') AND o.next_attempt_at<=inventory_clock() OR o.status='UNKNOWN' AND (o.next_attempt_at IS NULL OR o.next_attempt_at<=inventory_clock()) OR o.status='SENDING' AND o.claim_until<=inventory_clock()
 ORDER BY coalesce(o.next_attempt_at,o.claim_until,o.created_at),o.id LIMIT least(greatest(p_limit,0),20)
$$;
REVOKE ALL ON FUNCTION staff_notification_claim(uuid),staff_notification_material(uuid,uuid),staff_notification_settle(uuid,uuid,text,text,text),staff_notification_unknown(uuid),staff_notification_reconciled(uuid,text),staff_notification_due(integer) FROM PUBLIC;
