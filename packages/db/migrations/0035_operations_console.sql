-- M1.7 operations exception console, owned local databases only.
DO $$BEGIN IF current_database() !~ '^zr_[a-f0-9]{12}$' THEN RAISE EXCEPTION 'Dedicated development database required';END IF;END$$;
ALTER TABLE staff_role_permissions DROP CONSTRAINT staff_role_permissions_permission_check;
ALTER TABLE staff_permission_overrides DROP CONSTRAINT staff_permission_overrides_permission_check;
ALTER TABLE staff_role_permissions ADD CHECK(permission IN ('INVENTORY_VIEW','INVENTORY_EDIT','STAFF_MANAGE','HOLD_VIEW','HOLD_EDIT','TRANSFER_VIEW','TRANSFER_PLAN','TRANSFER_DISPATCH','TRANSFER_RECEIVE','QUOTE_VIEW','QUOTE_CREATE','PRICE_EDIT','BOOKING_VIEW','BOOKING_CREATE','RENTAL_CHECKOUT','RENTAL_RETURN','RENTAL_AMEND','REFUND_OVERRIDE','INVENTORY_RECONCILE','NOTIFICATION_RESEND','OPERATIONS_VIEW','OPERATIONS_ACKNOWLEDGE'));
ALTER TABLE staff_permission_overrides ADD CHECK(permission IN ('INVENTORY_VIEW','INVENTORY_EDIT','STAFF_MANAGE','HOLD_VIEW','HOLD_EDIT','TRANSFER_VIEW','TRANSFER_PLAN','TRANSFER_DISPATCH','TRANSFER_RECEIVE','QUOTE_VIEW','QUOTE_CREATE','PRICE_EDIT','BOOKING_VIEW','BOOKING_CREATE','RENTAL_CHECKOUT','RENTAL_RETURN','RENTAL_AMEND','REFUND_OVERRIDE','INVENTORY_RECONCILE','NOTIFICATION_RESEND','OPERATIONS_VIEW','OPERATIONS_ACKNOWLEDGE'));

-- An exception is an observation of existing business/audit state. It is never the
-- authority for payment, inventory, refund, custody or delivery, and acknowledging one
-- records only that a member of staff looked at it.
CREATE TABLE ops_exceptions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 event_type text NOT NULL CHECK(event_type IN ('PAYMENT_PENDING','PAYMENT_UNKNOWN','WEBHOOK_RECONCILIATION_REQUIRED','WEBHOOK_FAILED','HOLD_EXPIRED','TRANSFER_DELAYED','RETURN_INSPECTION_REQUIRED','INVENTORY_INVARIANT_FAILED','REFUND_PENDING','REFUND_UNKNOWN','NOTIFICATION_FAILED','STORAGE_FAILED','BOOKING_RECOVERY_FAILED','DB_UNAVAILABLE','PROVIDER_TIMEOUT')),
 source_type text NOT NULL CHECK(source_type IN ('PAYMENT','ADDITIONAL_PAYMENT','WEBHOOK','HOLD','TRANSFER','INSPECTION','STOCKTAKE','REFUND','NOTIFICATION','RUNTIME')),
 source_id uuid NOT NULL,source_version text NOT NULL CHECK(source_version ~ '^[a-f0-9]{32}$'),
 correlation_id uuid NOT NULL,booking_id uuid REFERENCES rental_bookings(id),asset_id uuid REFERENCES ledger_assets(id),
 store_id text NOT NULL CHECK(store_id IN ('MOUNTAIN_BASE','ONSEN_BASE','SYSTEM')),
 severity text NOT NULL CHECK(severity IN ('INFO','WARN','ERROR')),
 occurred_at timestamptz NOT NULL,observed_at timestamptz NOT NULL DEFAULT inventory_clock(),
 status text NOT NULL DEFAULT 'UNACKNOWLEDGED' CHECK(status IN ('UNACKNOWLEDGED','ACKNOWLEDGED')),
 resolved_at timestamptz,resolution_actor text REFERENCES staff_members(id),resolution_reason text CHECK(resolution_reason IN ('TRIAGED','ASSIGNED','VERIFIED_WITH_CANONICAL_RECORD')),
 CHECK((status='ACKNOWLEDGED')=(resolved_at IS NOT NULL AND resolution_actor IS NOT NULL AND resolution_reason IS NOT NULL)),
 UNIQUE(event_type,source_type,source_id,source_version,store_id)
);
CREATE INDEX ops_exception_recent ON ops_exceptions(store_id,occurred_at DESC,id DESC);
REVOKE ALL ON ops_exceptions FROM PUBLIC;

-- Safe references and states only: no recipient, provider payload, token, URL or error text.
-- Collection reads the authoritative rows and never writes to them.
CREATE VIEW ops_exception_sources AS
 SELECT CASE WHEN p.state IN ('UNKNOWN','REVIEW') THEN 'PAYMENT_UNKNOWN' ELSE 'PAYMENT_PENDING' END AS event_type,'PAYMENT'::text AS source_type,p.id AS source_id,md5(p.state||':'||p.updated_at::text) AS source_version,p.id AS correlation_id,b.id AS booking_id,NULL::uuid AS asset_id,b.conditions->>'pickupStore' AS store_id,CASE WHEN p.state IN ('UNKNOWN','REVIEW') THEN 'ERROR' ELSE 'WARN' END AS severity,p.updated_at AS occurred_at
 FROM rental_payment_attempts p JOIN rental_bookings b ON b.id=p.booking_id WHERE p.state IN ('SUBMITTING','PENDING','UNKNOWN','REVIEW')
 UNION ALL SELECT CASE WHEN c.state IN ('UNKNOWN','REVIEW') THEN 'PAYMENT_UNKNOWN' ELSE 'PAYMENT_PENDING' END,'ADDITIONAL_PAYMENT',c.id,md5(c.state||':'||c.updated_at::text),c.id,b.id,NULL,b.conditions->>'pickupStore',CASE WHEN c.state IN ('UNKNOWN','REVIEW') THEN 'ERROR' ELSE 'WARN' END,c.updated_at
 FROM ops_charge_requests c JOIN rental_bookings b ON b.id=c.booking_id WHERE c.state IN ('PENDING','UNKNOWN','REVIEW')
 UNION ALL SELECT CASE WHEN j.state IN ('BLOCKED','DEAD') THEN 'WEBHOOK_FAILED' ELSE 'WEBHOOK_RECONCILIATION_REQUIRED' END,'WEBHOOK',j.id,md5(j.state||':'||j.updated_at::text),j.id,b.id,NULL,coalesce(b.conditions->>'pickupStore','SYSTEM'),CASE WHEN j.state IN ('BLOCKED','DEAD') THEN 'ERROR' ELSE 'WARN' END,j.updated_at
 FROM payment_reconciliation.jobs j LEFT JOIN rental_payment_attempts p ON p.provider_id=j.payment_id AND p.merchant_id=j.merchant_id LEFT JOIN rental_bookings b ON b.id=p.booking_id WHERE j.state<>'RECONCILED'
 UNION ALL SELECT 'HOLD_EXPIRED','HOLD',h.id,md5(h.expires_at::text),h.id,b.id,NULL,h.pickup_store,'INFO',h.expires_at
 FROM inventory_holds h LEFT JOIN rental_bookings b ON b.hold_id=h.id WHERE h.expires_at<=inventory_clock() AND h.payment_state IN ('NONE','FAILURE') AND h.allocation_stage='PROVISIONAL' AND h.state IN ('ACTIVE','EXPIRED')
 UNION ALL SELECT 'TRANSFER_DELAYED','TRANSFER',t.id,md5(t.version::text),t.id,NULL,NULL,s.store_id,'WARN',t.planned_ready_at
 FROM transfer_batches t CROSS JOIN LATERAL unnest(ARRAY[t.source_store,t.destination_store]) s(store_id) WHERE t.state<>'CANCELLED' AND t.planned_ready_at<inventory_clock() AND EXISTS(SELECT 1 FROM transfer_pieces p WHERE p.batch_id=t.id AND p.state NOT IN ('READY','CLOSED','CANCELLED'))
 UNION ALL SELECT 'RETURN_INSPECTION_REQUIRED','INSPECTION',r.id,md5(r.id::text),r.id,l.booking_id,l.asset_id,r.received_store,'WARN',r.actual_received_at
 FROM rental_receipts r JOIN rental_loan_items l ON l.id=r.loan_item_id WHERE NOT EXISTS(SELECT 1 FROM rental_inspections i WHERE i.loan_item_id=l.id)
 UNION ALL SELECT 'INVENTORY_INVARIANT_FAILED','STOCKTAKE',k.id,md5(k.revision::text),k.id,NULL,NULL,k.store_id,'ERROR',k.created_at
 FROM ops_stocktakes k WHERE k.state='REVIEW_REQUIRED'
 UNION ALL SELECT CASE WHEN f.state IN ('UNKNOWN','REVIEW') THEN 'REFUND_UNKNOWN' ELSE 'REFUND_PENDING' END,'REFUND',f.id,md5(f.state||':'||f.updated_at::text),f.id,f.booking_id,NULL,f.acting_store,CASE WHEN f.state IN ('UNKNOWN','REVIEW') THEN 'ERROR' ELSE 'WARN' END,f.updated_at
 FROM ops_refund_requests f WHERE f.state IN ('PENDING','UNKNOWN','REVIEW')
 UNION ALL SELECT CASE WHEN n.event_type='BOOKING_RECOVERY' THEN 'BOOKING_RECOVERY_FAILED' ELSE 'NOTIFICATION_FAILED' END,'NOTIFICATION',n.id,md5(n.status||':'||n.attempt_count::text),n.id,n.booking_id,NULL,b.conditions->>'pickupStore',CASE WHEN n.status IN ('UNKNOWN','PERMANENT_FAILURE') THEN 'ERROR' ELSE 'WARN' END,n.created_at
 FROM booking_notification_outbox n JOIN rental_bookings b ON b.id=n.booking_id WHERE n.status IN ('UNKNOWN','PERMANENT_FAILURE','RETRYABLE_FAILURE');
REVOKE ALL ON ops_exception_sources FROM PUBLIC;

-- Store scope is enforced in SQL against the maintained session, never from the request.
CREATE FUNCTION ops_assert_console_store(p_store text,p_permission text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$BEGIN
 IF p_store IS NULL OR p_store NOT IN ('MOUNTAIN_BASE','ONSEN_BASE','SYSTEM') THEN RAISE EXCEPTION 'OPS_SCOPE_DENIED' USING ERRCODE='42501';END IF;
 PERFORM ops_assert_actor(p_permission,CASE WHEN p_store='SYSTEM' THEN ARRAY[]::text[] ELSE ARRAY[p_store] END,current_setting('zao.actor',true));
 -- Global/system events need explicit ALL scope; assigned staff never see them.
 IF p_store='SYSTEM' AND NOT EXISTS(SELECT 1 FROM staff_members WHERE id=current_setting('zao.actor',true) AND scope='ALL') THEN RAISE EXCEPTION 'OPS_SCOPE_DENIED' USING ERRCODE='42501';END IF;
END$$;
CREATE FUNCTION ops_collect_exceptions(p_store text) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$DECLARE n integer;BEGIN
 PERFORM ops_assert_console_store(p_store,'OPERATIONS_VIEW');
 INSERT INTO ops_exceptions(event_type,source_type,source_id,source_version,correlation_id,booking_id,asset_id,store_id,severity,occurred_at)
 SELECT event_type,source_type,source_id,source_version,correlation_id,booking_id,asset_id,store_id,severity,occurred_at FROM ops_exception_sources WHERE store_id=p_store ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS n=ROW_COUNT;RETURN n;
END$$;
-- Runtime transport/media/database failures report a fixed code only. No Error, request,
-- response or provider object can reach this port, and observation never rolls back business work.
CREATE FUNCTION ops_observe_signal(p_code text,p_correlation uuid,p_store text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$DECLARE result uuid;BEGIN
 IF p_code IS NULL OR p_code NOT IN ('STORAGE_FAILED','NOTIFICATION_FAILED','BOOKING_RECOVERY_FAILED','DB_UNAVAILABLE','PROVIDER_TIMEOUT','WEBHOOK_FAILED') OR p_correlation IS NULL OR p_store IS NULL OR p_store NOT IN ('MOUNTAIN_BASE','ONSEN_BASE','SYSTEM') THEN RAISE EXCEPTION 'OPS_EVENT_REJECTED' USING ERRCODE='23514';END IF;
 INSERT INTO ops_exceptions(event_type,source_type,source_id,source_version,correlation_id,store_id,severity,occurred_at) VALUES(p_code,'RUNTIME',p_correlation,md5('SIGNAL_V1'),p_correlation,p_store,'ERROR',inventory_clock()) ON CONFLICT DO NOTHING;
 SELECT id INTO result FROM ops_exceptions WHERE event_type=p_code AND source_type='RUNTIME' AND source_id=p_correlation AND source_version=md5('SIGNAL_V1') AND store_id=p_store;RETURN result;
END$$;
-- Acknowledgement records that staff looked at the exception. It changes no payment,
-- refund, booking, inventory, HOLD, custody, transfer or delivery row.
CREATE FUNCTION ops_acknowledge_exception(p_id uuid,p_store text,p_reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$DECLARE e ops_exceptions;BEGIN
 PERFORM ops_assert_console_store(p_store,'OPERATIONS_VIEW');PERFORM ops_assert_console_store(p_store,'OPERATIONS_ACKNOWLEDGE');
 IF p_reason IS NULL OR p_reason NOT IN ('TRIAGED','ASSIGNED','VERIFIED_WITH_CANONICAL_RECORD') THEN RAISE EXCEPTION 'OPS_REASON_REQUIRED' USING ERRCODE='23514';END IF;
 SELECT * INTO e FROM ops_exceptions WHERE id=p_id AND store_id=p_store FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'OPS_SCOPE_DENIED' USING ERRCODE='42501';END IF;
 IF e.status='UNACKNOWLEDGED' THEN
  UPDATE ops_exceptions SET status='ACKNOWLEDGED',resolved_at=inventory_clock(),resolution_actor=current_setting('zao.actor'),resolution_reason=p_reason WHERE id=e.id RETURNING * INTO e;
  INSERT INTO ops_history(resource,entity_id,actor,event,after_data) VALUES('ops_exceptions',e.id,current_setting('zao.actor'),'EXCEPTION_ACKNOWLEDGED',jsonb_build_object('eventType',e.event_type,'store',p_store,'reason',p_reason,'businessStateChanged',false));
 END IF;
 RETURN jsonb_build_object('id',e.id,'status',e.status,'resolutionReason',e.resolution_reason,'businessStateChanged',false);
END$$;
-- Bounded page with a stable (occurred_at,id) cursor. The source condition is derived
-- read-only; an acknowledged exception whose source is still active stays visibly active.
CREATE FUNCTION ops_list_exceptions(p_store text,p_type text,p_severity text,p_age integer,p_status text,p_before_time timestamptz,p_before_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$DECLARE result jsonb;BEGIN
 PERFORM ops_assert_console_store(p_store,'OPERATIONS_VIEW');
 IF p_age IS NULL OR p_age<0 OR p_age>8760 OR p_status IS NULL OR p_status NOT IN ('UNACKNOWLEDGED','ACKNOWLEDGED','ALL') OR (p_before_time IS NULL)<>(p_before_id IS NULL) OR (p_type IS NOT NULL AND p_type NOT IN ('PAYMENT_PENDING','PAYMENT_UNKNOWN','WEBHOOK_RECONCILIATION_REQUIRED','WEBHOOK_FAILED','HOLD_EXPIRED','TRANSFER_DELAYED','RETURN_INSPECTION_REQUIRED','INVENTORY_INVARIANT_FAILED','REFUND_PENDING','REFUND_UNKNOWN','NOTIFICATION_FAILED','STORAGE_FAILED','BOOKING_RECOVERY_FAILED','DB_UNAVAILABLE','PROVIDER_TIMEOUT')) OR (p_severity IS NOT NULL AND p_severity NOT IN ('INFO','WARN','ERROR')) THEN RAISE EXCEPTION 'OPS_FILTER_INVALID' USING ERRCODE='23514';END IF;
 SELECT coalesce(jsonb_agg(x ORDER BY x."occurredAt" DESC,x.id DESC),'[]'::jsonb) INTO result FROM (
  SELECT e.id,e.event_type AS "eventType",e.correlation_id AS "correlationId",e.booking_id AS "bookingId",e.asset_id AS "assetId",e.store_id AS store,e.severity,e.status,e.occurred_at AS "occurredAt",e.resolved_at AS "resolvedAt",e.resolution_actor AS "resolutionActor",e.resolution_reason AS "resolutionReason",
  CASE WHEN e.source_type='RUNTIME' THEN NULL ELSE EXISTS(SELECT 1 FROM ops_exception_sources s WHERE (s.event_type,s.source_type,s.source_id,s.source_version,s.store_id)=(e.event_type,e.source_type,e.source_id,e.source_version,e.store_id)) END AS "sourceConditionActive"
  FROM ops_exceptions e WHERE e.store_id=p_store AND (p_type IS NULL OR e.event_type=p_type) AND (p_severity IS NULL OR e.severity=p_severity) AND e.occurred_at<=inventory_clock()-make_interval(hours=>p_age) AND (p_status='ALL' OR e.status=p_status) AND (p_before_time IS NULL OR (e.occurred_at,e.id)<(p_before_time,p_before_id)) ORDER BY e.occurred_at DESC,e.id DESC LIMIT 51
 ) x;RETURN result;
END$$;
REVOKE ALL ON FUNCTION ops_assert_console_store(text,text),ops_collect_exceptions(text),ops_observe_signal(text,uuid,text),ops_acknowledge_exception(uuid,text,text),ops_list_exceptions(text,text,text,integer,text,timestamptz,uuid) FROM PUBLIC;
