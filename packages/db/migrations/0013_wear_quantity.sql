-- Quantity pools, never physical garment/serial/pseudo-Asset rows. IDs identify pools/events.
CREATE TABLE wear_pools(
 id uuid PRIMARY KEY,variant_id uuid NOT NULL REFERENCES ledger_variants(id),store_id text NOT NULL REFERENCES ledger_stores(id),
 ready integer NOT NULL DEFAULT 0 CHECK(ready>=0),on_loan integer NOT NULL DEFAULT 0 CHECK(on_loan>=0),returned_pending integer NOT NULL DEFAULT 0 CHECK(returned_pending>=0),
 cleaning integer NOT NULL DEFAULT 0 CHECK(cleaning>=0),today_blocked integer NOT NULL DEFAULT 0 CHECK(today_blocked>=0),in_transit integer NOT NULL DEFAULT 0 CHECK(in_transit>=0),unavailable integer NOT NULL DEFAULT 0 CHECK(unavailable>=0),
 total integer GENERATED ALWAYS AS (ready+on_loan+returned_pending+cleaning+today_blocked+in_transit+unavailable) STORED,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),UNIQUE(variant_id,store_id)
);
CREATE TABLE wear_claims(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,hold_id uuid NOT NULL REFERENCES inventory_holds(id),requirement_key text NOT NULL,pool_id uuid NOT NULL REFERENCES wear_pools(id),day date NOT NULL,quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 20),active boolean NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX wear_one_requirement_day ON wear_claims(hold_id,requirement_key,day) WHERE active;
CREATE INDEX wear_pool_day ON wear_claims(pool_id,day) WHERE active;
CREATE TABLE wear_loans(
 id uuid PRIMARY KEY,cycle_id uuid NOT NULL,booking_id uuid NOT NULL REFERENCES rental_bookings(id),member_key text NOT NULL,requirement_key text NOT NULL,
 pool_id uuid NOT NULL REFERENCES wear_pools(id),variant_id uuid NOT NULL REFERENCES ledger_variants(id),quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 1000),returned integer NOT NULL DEFAULT 0 CHECK(returned>=0 AND returned<=quantity),
 planned_pickup_store text NOT NULL REFERENCES ledger_stores(id),actual_pickup_store text NOT NULL REFERENCES ledger_stores(id),planned_return_store text NOT NULL REFERENCES ledger_stores(id),
 checked_out_at timestamptz NOT NULL,revision integer NOT NULL DEFAULT 1 CHECK(revision>0),actor text NOT NULL REFERENCES staff_members(id),UNIQUE(booking_id,requirement_key)
);
CREATE TABLE wear_receipts(
 id uuid PRIMARY KEY,loan_id uuid NOT NULL REFERENCES wear_loans(id),pool_id uuid NOT NULL REFERENCES wear_pools(id),quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 1000),
 actual_store text NOT NULL REFERENCES ledger_stores(id),received_at timestamptz NOT NULL,confirmed_at timestamptz NOT NULL,ready_at timestamptz,
 eligible_on date NOT NULL,state text NOT NULL CHECK(state IN ('RETURNED_PENDING','CLEANING','TODAY_BLOCKED','READY','UNAVAILABLE')),
 actor text NOT NULL REFERENCES staff_members(id),revision integer NOT NULL DEFAULT 1 CHECK(revision>0),CHECK(received_at<=confirmed_at),CHECK(ready_at IS NULL OR ready_at>=received_at)
);
CREATE TABLE wear_unresolved_returns(
 id uuid PRIMARY KEY,variant_id uuid NOT NULL REFERENCES ledger_variants(id),store_id text NOT NULL REFERENCES ledger_stores(id),quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 1000),received_at timestamptz NOT NULL,actor text NOT NULL REFERENCES staff_members(id),reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 160),receipt_id uuid UNIQUE REFERENCES wear_receipts(id),revision integer NOT NULL DEFAULT 1 CHECK(revision>0)
);
CREATE TABLE wear_transfers(
 id uuid PRIMARY KEY,source_pool_id uuid NOT NULL REFERENCES wear_pools(id),destination_store text NOT NULL REFERENCES ledger_stores(id),quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 1000),received integer NOT NULL DEFAULT 0 CHECK(received>=0 AND received<=quantity),
 scheduled_at timestamptz NOT NULL,departed_at timestamptz,state text NOT NULL CHECK(state IN ('PLANNED','IN_TRANSIT','RECEIVED','CANCELLED')),revision integer NOT NULL DEFAULT 1 CHECK(revision>0)
);
CREATE TABLE wear_transfer_receipts(
 id uuid PRIMARY KEY,transfer_id uuid NOT NULL REFERENCES wear_transfers(id),pool_id uuid NOT NULL REFERENCES wear_pools(id),quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 1000),received_at timestamptz NOT NULL,ready_at timestamptz,eligible_on date NOT NULL,state text NOT NULL CHECK(state IN ('RETURNED_PENDING','TODAY_BLOCKED','READY')),revision integer NOT NULL DEFAULT 1 CHECK(revision>0)
);
CREATE TABLE wear_requests(actor text NOT NULL REFERENCES staff_members(id),request_id uuid NOT NULL,fingerprint text NOT NULL CHECK(length(fingerprint)=64),result jsonb NOT NULL,PRIMARY KEY(actor,request_id));
CREATE TABLE wear_history(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,entity text NOT NULL,entity_id text NOT NULL,actor text NOT NULL REFERENCES staff_members(id),reason text NOT NULL,before_data jsonb,after_data jsonb NOT NULL,occurred_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE FUNCTION wear_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE mutable text[];
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Wear history and identities are retained';END IF;
 IF coalesce(current_setting('zao.actor',true),'')='' OR length(coalesce(current_setting('zao.reason',true),'')) NOT BETWEEN 1 AND 160 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Wear trusted audit context required'; END IF;
 IF TG_OP='UPDATE' THEN
  IF NEW.id<>OLD.id THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Immutable wear identity'; END IF;
  mutable:=CASE TG_TABLE_NAME WHEN 'wear_loans' THEN ARRAY['returned','revision'] WHEN 'wear_receipts' THEN ARRAY['state','ready_at','revision'] WHEN 'wear_unresolved_returns' THEN ARRAY['receipt_id','revision'] WHEN 'wear_transfers' THEN ARRAY['state','received','departed_at','revision'] WHEN 'wear_transfer_receipts' THEN ARRAY['state','ready_at','revision'] ELSE NULL END;
  IF mutable IS NOT NULL AND (to_jsonb(NEW)-mutable)<>(to_jsonb(OLD)-mutable) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Immutable wear event facts';END IF;
  IF TG_TABLE_NAME='wear_loans' AND (to_jsonb(NEW)->>'returned')::int<(to_jsonb(OLD)->>'returned')::int THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Receipt reversal requires a separate future correction';END IF;
  IF TG_TABLE_NAME='wear_unresolved_returns' AND to_jsonb(OLD)->>'receipt_id' IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Unresolved receipt already reconciled';END IF;
  NEW.revision:=OLD.revision+1;
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION wear_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN INSERT INTO wear_history(entity,entity_id,actor,reason,before_data,after_data) VALUES(TG_TABLE_NAME,NEW.id::text,current_setting('zao.actor'),current_setting('zao.reason'),CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE NULL END,to_jsonb(NEW));RETURN NEW;END $$;
CREATE TRIGGER wear_history_append_only BEFORE INSERT OR UPDATE OR DELETE ON wear_history FOR EACH ROW EXECUTE FUNCTION ledger_append_only();
DO $$DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['wear_pools','wear_loans','wear_receipts','wear_unresolved_returns','wear_transfers','wear_transfer_receipts'] LOOP
 EXECUTE format('CREATE TRIGGER wear_lock BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH STATEMENT EXECUTE FUNCTION inventory_lock()',t);
 EXECUTE format('CREATE TRIGGER wear_guard BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION wear_guard()',t);
 EXECUTE format('CREATE TRIGGER wear_audit AFTER INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION wear_audit()',t);
END LOOP;END $$;
CREATE TRIGGER wear_claims_lock BEFORE INSERT OR UPDATE OR DELETE ON wear_claims FOR EACH STATEMENT EXECUTE FUNCTION inventory_lock();
CREATE FUNCTION wear_pool_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE planned integer;
BEGIN
 -- Ready-only edits (including plan validation) must preserve every promise.
 -- Actual checkout/receipt moves conserved physical buckets. A later promise may
 -- need care/relocation; never reject a factual receipt or restore origin stock.
 IF TG_OP='UPDATE' AND (NEW.on_loan,NEW.returned_pending,NEW.cleaning,NEW.today_blocked,NEW.in_transit,NEW.unavailable) IS DISTINCT FROM (OLD.on_loan,OLD.returned_pending,OLD.cleaning,OLD.today_blocked,OLD.in_transit,OLD.unavailable) THEN
  IF NEW.variant_id<>OLD.variant_id OR NEW.store_id<>OLD.store_id THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Immutable wear pool dimensions';END IF;
  IF NEW.on_loan<>OLD.on_loan AND NEW.on_loan<>(SELECT coalesce(sum(quantity-returned),0) FROM wear_loans WHERE pool_id=NEW.id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Wear loan quantity evidence mismatch';END IF;
  IF NEW.in_transit<>OLD.in_transit AND NEW.in_transit<>(SELECT coalesce(sum(quantity-received),0) FROM wear_transfers WHERE source_pool_id=NEW.id AND state='IN_TRANSIT') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Wear transfer quantity evidence mismatch';END IF;
  IF NEW.returned_pending<>OLD.returned_pending AND NEW.returned_pending<>((SELECT coalesce(sum(quantity),0) FROM wear_receipts WHERE pool_id=NEW.id AND state='RETURNED_PENDING')+(SELECT coalesce(sum(quantity),0) FROM wear_transfer_receipts WHERE pool_id=NEW.id AND state='RETURNED_PENDING')) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Wear pending quantity evidence mismatch';END IF;
  IF NEW.cleaning<>OLD.cleaning AND NEW.cleaning<>(SELECT coalesce(sum(quantity),0) FROM wear_receipts WHERE pool_id=NEW.id AND state='CLEANING') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Wear care quantity evidence mismatch';END IF;
  IF NEW.today_blocked<>OLD.today_blocked AND NEW.today_blocked<>(SELECT coalesce(sum(quantity),0) FROM wear_receipts WHERE pool_id=NEW.id AND state='TODAY_BLOCKED') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Wear same-day quantity evidence mismatch';END IF;
  RETURN NEW;
 END IF;
 SELECT coalesce(sum(quantity),0) INTO planned FROM wear_transfers WHERE source_pool_id=NEW.id AND state='PLANNED';
 IF planned>NEW.ready THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Planned wear transfer protection';END IF;
 IF TG_OP='UPDATE' AND (NEW.variant_id<>OLD.variant_id OR NEW.store_id<>OLD.store_id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Immutable wear pool dimensions';END IF;
 IF NOT EXISTS(SELECT 1 FROM ledger_variants WHERE id=NEW.variant_id AND family IN ('WEAR_JACKET','WEAR_PANTS') AND tier='STANDARD') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Wear part variant required'; END IF;
 IF EXISTS(SELECT 1 FROM wear_claims c JOIN inventory_holds h ON h.id=c.hold_id WHERE c.active AND c.pool_id=NEW.id AND h.state='ACTIVE' AND (h.expires_at>inventory_clock() OR h.payment_state IN ('PENDING','UNKNOWN','SUCCESS') OR h.allocation_stage<>'PROVISIONAL') AND NOT EXISTS(SELECT 1 FROM wear_loans l WHERE l.booking_id=h.reservation_id) GROUP BY c.day HAVING sum(c.quantity)+planned>NEW.ready) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Protected wear capacity';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER wear_pool_guard BEFORE INSERT OR UPDATE ON wear_pools FOR EACH ROW EXECUTE FUNCTION wear_pool_guard();
CREATE FUNCTION wear_claim_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE h inventory_holds;p wear_pools;used integer;planned integer;
BEGIN
 IF NOT NEW.active THEN RETURN NEW;END IF;
 SELECT * INTO STRICT h FROM inventory_holds WHERE id=NEW.hold_id;SELECT * INTO STRICT p FROM wear_pools WHERE id=NEW.pool_id;
 IF h.state<>'ACTIVE' OR p.store_id<>h.pickup_store OR NEW.day<h.occupancy_start OR NEW.day>h.occupancy_end THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid wear capacity claim'; END IF;
 SELECT coalesce(sum(c.quantity),0) INTO used FROM wear_claims c JOIN inventory_holds x ON x.id=c.hold_id WHERE c.active AND c.pool_id=p.id AND c.day=NEW.day AND c.id<>NEW.id AND x.state='ACTIVE' AND (x.expires_at>inventory_clock() OR x.payment_state IN ('PENDING','UNKNOWN','SUCCESS') OR x.allocation_stage<>'PROVISIONAL') AND NOT EXISTS(SELECT 1 FROM wear_loans l WHERE l.booking_id=x.reservation_id);
 SELECT coalesce(sum(quantity),0) INTO planned FROM wear_transfers WHERE source_pool_id=p.id AND state='PLANNED';
 IF used+NEW.quantity+planned>p.ready THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Wear capacity exceeded';END IF;RETURN NEW;
END $$;
CREATE TRIGGER wear_claim_guard BEFORE INSERT OR UPDATE ON wear_claims FOR EACH ROW EXECUTE FUNCTION wear_claim_guard();
REVOKE ALL ON FUNCTION wear_guard(),wear_audit(),wear_pool_guard(),wear_claim_guard() FROM PUBLIC;
