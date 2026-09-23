-- Shared booking/custody roles read witnesses, but cannot mutate a witness table directly.
-- Wear operations retain their maintained staff session, scoped permission, inventory lock,
-- and existing evidence/conservation triggers through these fixed operations only.
CREATE FUNCTION wear_pool_create(pool_id uuid,variant uuid,store text,permission text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$BEGIN
 IF permission IS NULL OR permission NOT IN ('INVENTORY_EDIT','RENTAL_RETURN','TRANSFER_RECEIVE') THEN RAISE EXCEPTION 'WEAR_POOL_FORBIDDEN' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(71820600);
 PERFORM ops_assert_actor(permission,ARRAY[store],current_setting('zao.actor',true));
 INSERT INTO wear_pools(id,variant_id,store_id) VALUES(pool_id,variant,store);
END$$;
CREATE FUNCTION wear_pool_apply(pool_id uuid,operation text,quantity integer,reference uuid DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE p wear_pools;permission text;stores text[];destination text;
BEGIN
 PERFORM pg_advisory_xact_lock(71820600);
 SELECT * INTO p FROM wear_pools WHERE id=pool_id FOR UPDATE;
 IF NOT FOUND OR quantity IS NULL OR quantity<0 OR quantity>1000 THEN RAISE EXCEPTION 'WEAR_POOL_INPUT' USING ERRCODE='23514';END IF;
 stores:=ARRAY[p.store_id];
 CASE operation
 WHEN 'SET_READY','IMPORT_READY','IMPORT_UNAVAILABLE' THEN permission:='INVENTORY_EDIT';
 WHEN 'CHECKOUT' THEN permission:='RENTAL_CHECKOUT';
 WHEN 'RETURN_IN','CARE_START','CARE_BLOCK','CARE_READY','CARE_RELEASE' THEN permission:='RENTAL_RETURN';
 WHEN 'RETURN_OUT' THEN
  SELECT r.actual_store INTO destination FROM wear_receipts r JOIN wear_loans l ON l.id=r.loan_id WHERE r.id=reference AND l.pool_id=p.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'WEAR_RECEIPT_REQUIRED' USING ERRCODE='23514';END IF;
  stores:=ARRAY[destination];permission:='RENTAL_RETURN';
 WHEN 'TRANSFER_PLAN' THEN
  SELECT destination_store INTO destination FROM wear_transfers WHERE id=reference AND source_pool_id=p.id AND state='PLANNED';
  IF NOT FOUND THEN RAISE EXCEPTION 'WEAR_TRANSFER_REQUIRED' USING ERRCODE='23514';END IF;
  stores:=ARRAY[p.store_id,destination];permission:='TRANSFER_PLAN';
 WHEN 'TRANSFER_DISPATCH' THEN permission:='TRANSFER_DISPATCH';
 WHEN 'TRANSFER_IN','TRANSFER_READY' THEN permission:='TRANSFER_RECEIVE';
 WHEN 'TRANSFER_OUT' THEN
  SELECT destination_store INTO destination FROM wear_transfers WHERE id=reference AND source_pool_id=p.id AND state IN ('IN_TRANSIT','RECEIVED');
  IF NOT FOUND THEN RAISE EXCEPTION 'WEAR_TRANSFER_REQUIRED' USING ERRCODE='23514';END IF;
  stores:=ARRAY[destination];permission:='TRANSFER_RECEIVE';
 ELSE RAISE EXCEPTION 'WEAR_POOL_FORBIDDEN' USING ERRCODE='42501';
 END CASE;
 PERFORM ops_assert_actor(permission,stores,current_setting('zao.actor',true));
 CASE operation
 WHEN 'SET_READY' THEN UPDATE wear_pools SET ready=quantity WHERE id=p.id;
 WHEN 'IMPORT_READY' THEN UPDATE wear_pools SET ready=ready+quantity WHERE id=p.id;
 WHEN 'IMPORT_UNAVAILABLE' THEN UPDATE wear_pools SET unavailable=unavailable+quantity WHERE id=p.id;
 WHEN 'CHECKOUT' THEN UPDATE wear_pools SET ready=ready-quantity,on_loan=on_loan+quantity WHERE id=p.id;
 WHEN 'RETURN_OUT' THEN UPDATE wear_pools SET on_loan=on_loan-quantity WHERE id=p.id;
 WHEN 'RETURN_IN','TRANSFER_IN' THEN UPDATE wear_pools SET returned_pending=returned_pending+quantity WHERE id=p.id;
 WHEN 'CARE_START' THEN UPDATE wear_pools SET returned_pending=returned_pending-quantity,cleaning=cleaning+quantity WHERE id=p.id;
 WHEN 'CARE_BLOCK' THEN UPDATE wear_pools SET cleaning=cleaning-quantity,today_blocked=today_blocked+quantity WHERE id=p.id;
 WHEN 'CARE_READY' THEN UPDATE wear_pools SET cleaning=cleaning-quantity,ready=ready+quantity WHERE id=p.id;
 WHEN 'CARE_RELEASE' THEN UPDATE wear_pools SET today_blocked=today_blocked-quantity,ready=ready+quantity WHERE id=p.id;
 WHEN 'TRANSFER_PLAN' THEN UPDATE wear_pools SET ready=ready WHERE id=p.id;
 WHEN 'TRANSFER_DISPATCH' THEN UPDATE wear_pools SET ready=ready-quantity,in_transit=in_transit+quantity WHERE id=p.id;
 WHEN 'TRANSFER_OUT' THEN UPDATE wear_pools SET in_transit=in_transit-quantity WHERE id=p.id;
 WHEN 'TRANSFER_READY' THEN UPDATE wear_pools SET returned_pending=returned_pending-quantity,ready=ready+quantity WHERE id=p.id;
 END CASE;
END$$;
REVOKE ALL ON FUNCTION wear_pool_create(uuid,uuid,text,text),wear_pool_apply(uuid,text,integer,uuid) FROM PUBLIC;
